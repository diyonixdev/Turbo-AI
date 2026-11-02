/**
 * Shared /api/chat implementation used by:
 *  - server/index.js  (local Express development server)
 *  - api/chat.js      (Vercel serverless function)
 *
 * The Gemini API key is read from the environment on the server only and is
 * never logged, echoed in error messages or exposed to the client.
 */

const DEFAULT_TIMEOUT_MS = 30000
// gemini-2.5-flash is closed to new API keys, and the full Flash models are often
// overloaded (503 "high demand") or hang. The lite models answer in 1-3 s.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const DEFAULT_FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite']
// One attempt may not use the whole budget, so a hanging model still leaves
// time to try a fallback model.
const ATTEMPT_TIMEOUT_MS = 12000
// A 5xx or dropped connection gets one quick retry on the same model before
// moving on to the next model.
const RETRY_DELAYS_MS = [700]
const RETRYABLE_UPSTREAM_STATUSES = new Set([500, 502, 503, 504])
const MAX_MESSAGES = 20
const MAX_CONTENT_LENGTH = 4000
const TELEMETRY_FIELDS = [
  'batteryCharge',
  'chargingEtaMinutes',
  'rpm',
  'temperatureCelsius',
  'pressureBar',
  'recoveredPowerWatts',
  'recoveryEfficiency',
]

export function readConfig() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim()
  // Comma-separated; unset uses the defaults, an empty value disables fallback.
  const rawFallbacks = process.env.GEMINI_FALLBACK_MODELS
  const fallbackModels = (rawFallbacks === undefined ? DEFAULT_FALLBACK_MODELS : rawFallbacks.split(','))
    .map((name) => name.trim())
    .filter((name, index, all) => name && name !== model && all.indexOf(name) === index)
  const rawTimeout = Number.parseInt(process.env.CHAT_TIMEOUT_MS || process.env.OPENROUTER_TIMEOUT_MS || '', 10)
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS
  return { apiKey, model, fallbackModels, timeoutMs }
}

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } })
}

function safeRequestId(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? ` rid=${raw}` : ''
}

function log(source, rid, event, detail) {
  console.log(`[chat:${source}] ${event}${detail || ''}${rid || ''}`)
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return { message: 'messages must be a non-empty array.' }
  if (messages.length > MAX_MESSAGES) return { message: `messages must contain at most ${MAX_MESSAGES} items.` }
  const cleaned = []
  for (const item of messages) {
    if (!item || typeof item !== 'object') return { message: 'each message must be an object with role and content.' }
    if (item.role !== 'user' && item.role !== 'assistant') return { message: "each message role must be 'user' or 'assistant'." }
    if (typeof item.content !== 'string' || !item.content.trim()) return { message: 'each message needs a non-empty string content.' }
    if (item.content.length > MAX_CONTENT_LENGTH) return { message: `message content must be at most ${MAX_CONTENT_LENGTH} characters.` }
    cleaned.push({ role: item.role, content: item.content.trim() })
  }
  return { messages: cleaned }
}

function sanitizeTelemetry(input) {
  if (!input || typeof input !== 'object') return null
  const clean = {}
  for (const field of TELEMETRY_FIELDS) {
    const value = Number(input[field])
    if (Number.isFinite(value)) clean[field] = Math.round(value * 10) / 10
  }
  return Object.keys(clean).length > 0 ? clean : null
}

function num(value) {
  return String(Math.round(value * 10) / 10)
}

export function buildSystemPrompt(language, telemetry) {
  const lines = [
    'You are Turbo AI, a natural, concise automotive energy assistant embedded in the Turbo AI vehicle dashboard.',
    language === 'hi'
      ? 'Respond in Hindi (हिंदी). The user may write in English, Hindi or Hinglish — understand all three.'
      : 'Respond in English. The user may write in English, Hindi or Hinglish — understand all three.',
    'Cover battery charge, engine RPM, exhaust temperature, exhaust pressure and energy recovery when asked.',
  ]
  if (telemetry) {
    lines.push(
      'Live values supplied by the dashboard — use these exact readings and never invent other live values:',
      `- Battery charge: ${num(telemetry.batteryCharge)}% | Time to full: ${num(telemetry.chargingEtaMinutes)} min`,
      `- Engine RPM: ${num(telemetry.rpm)}`,
      `- Exhaust temperature: ${num(telemetry.temperatureCelsius)} °C`,
      `- Exhaust pressure: ${num(telemetry.pressureBar)} bar`,
      `- Recovered power: ${num(telemetry.recoveredPowerWatts)} W | Recovery efficiency: ${num(telemetry.recoveryEfficiency)}%`
    )
  } else {
    lines.push('No live values were supplied for this message — say the reading is unavailable instead of guessing.')
  }
  lines.push(
    'These are simulated readings supplied by the app. You only read them: never claim to control, adjust or reset vehicle hardware or sensors.',
    'Keep replies to 1-3 sentences unless the user asks for more detail.'
  )
  return lines.join('\n')
}

/**
 * Gemini 2.5 Flash "thinks" by default and those thinking tokens count against
 * maxOutputTokens, so a reply can run out of budget before any text is written
 * (an empty reply). Flash allows thinking to be switched off; other models
 * either cannot disable it or do not accept thinkingConfig, so they are left alone.
 */
export function buildGenerationConfig(model) {
  const config = { temperature: 0.6, maxOutputTokens: 700 }
  if (/^gemini-2\.5-flash/.test(model)) config.thinkingConfig = { thinkingBudget: 0 }
  return config
}

/** Text of the first candidate, joining every non-thought text part. */
export function extractReply(data) {
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part) => part && typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One generateContent call with its own time limit. Never throws: returns
 * { kind: 'ok', reply } | { kind: 'empty', finish } | { kind: 'http', status, msg }
 * | { kind: 'timeout' } | { kind: 'network' }.
 */
async function callGemini(model, body, apiKey, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        // The key travels in a header so it never appears in URLs or access logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
      }
    )
    const data = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      const msg = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 300) : ''
      return { kind: 'http', status: upstream.status, msg }
    }
    const reply = extractReply(data)
    if (!reply) return { kind: 'empty', finish: data?.candidates?.[0]?.finishReason || 'none' }
    return { kind: 'ok', reply }
  } catch (error) {
    const name = error && error.name
    return { kind: name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** Maps the last failed attempt to the response the client sees. */
function failFromAttempt(res, outcome) {
  if (!outcome || outcome.kind === 'timeout') return fail(res, 504, 'timeout', 'The model took too long to respond.')
  if (outcome.kind === 'network') return fail(res, 502, 'upstream', 'Could not reach Gemini.')
  if (outcome.kind === 'empty') return fail(res, 502, 'upstream', 'The model returned an empty response.')
  if (outcome.status === 429) return fail(res, 429, 'rate_limit', outcome.msg || 'Rate limit reached.')
  if (outcome.status === 404) return fail(res, 502, 'model_unavailable', outcome.msg || 'The configured Gemini model was not found.')
  return fail(res, 502, 'upstream', outcome.msg || 'Gemini request failed.')
}

export async function handleChat(req, res, options = {}) {
  const source = options.source || 'server'
  const startedAt = Date.now()
  const rid = safeRequestId(req.headers && req.headers['x-request-id'])

  if (req.method !== 'POST') {
    return fail(res, 405, 'invalid_request', 'Only POST requests are supported.')
  }

  const { apiKey, model, fallbackModels, timeoutMs } = readConfig()
  const body = req.body

  if (!body || typeof body !== 'object') {
    return fail(res, 400, 'invalid_request', 'Request body must be a JSON object.')
  }

  const validated = validateMessages(body.messages)
  if (validated.message) {
    return fail(res, 400, 'invalid_request', validated.message)
  }

  const language = body.language === 'hi' ? 'hi' : 'en'
  const telemetry = sanitizeTelemetry(body.telemetry)

  if (!apiKey) {
    log(source, rid, 'missing-key', '| GEMINI_API_KEY is not configured')
    return fail(res, 503, 'missing_key', 'GEMINI_API_KEY is not configured on the server.')
  }
  if (!model) {
    log(source, rid, 'missing-model', '| GEMINI_MODEL is not configured')
    return fail(res, 503, 'missing_model', 'GEMINI_MODEL is not configured on the server.')
  }

  const systemPrompt = buildSystemPrompt(language, telemetry)
  // Gemini conversations must open with a user turn, so leading assistant
  // messages (the on-screen greeting) are dropped from the history sent.
  const firstUser = validated.messages.findIndex((item) => item.role === 'user')
  const turns = firstUser < 0 ? validated.messages : validated.messages.slice(firstUser)
  const bodyFor = (name) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: turns.map((item) => ({
        role: item.role === 'user' ? 'user' : 'model',
        parts: [{ text: item.content }],
      })),
      generationConfig: buildGenerationConfig(name),
    })

  const models = [model, ...fallbackModels]
  log(source, rid, 'request', `| lang=${language} | turns=${turns.length} | models=${models.join(',')}`)

  const deadline = startedAt + timeoutMs
  let lastFailure = null
  for (const name of models) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const outcome = await callGemini(name, bodyFor(name), apiKey, Math.min(ATTEMPT_TIMEOUT_MS, remaining))
      if (outcome.kind === 'ok') {
        log(source, rid, 'ok', `| ms=${Date.now() - startedAt} | lang=${language} | model=${name}`)
        return res.status(200).json({ reply: outcome.reply, model: name })
      }
      lastFailure = outcome
      const detail = outcome.kind === 'http' ? `status=${outcome.status}` : outcome.kind === 'empty' ? `empty finish=${outcome.finish}` : outcome.kind
      log(source, rid, 'attempt-failed', `| model=${name} | ${detail} | ms=${Date.now() - startedAt}`)
      // A rejected key fails the same way on every model.
      if (outcome.kind === 'http' && [401, 402, 403].includes(outcome.status)) {
        return fail(res, 502, 'auth', 'Gemini rejected the API key.')
      }
      const retrySameModel =
        outcome.kind === 'network' || (outcome.kind === 'http' && RETRYABLE_UPSTREAM_STATUSES.has(outcome.status))
      if (!retrySameModel || attempt >= RETRY_DELAYS_MS.length) break
      await sleep(Math.min(RETRY_DELAYS_MS[attempt], Math.max(0, deadline - Date.now())))
    }
    if (deadline - Date.now() <= 0) break
  }

  if (deadline - Date.now() <= 0 && lastFailure?.kind !== 'http') lastFailure = { kind: 'timeout' }
  log(source, rid, 'failed', `| ms=${Date.now() - startedAt}`)
  return failFromAttempt(res, lastFailure)
}
