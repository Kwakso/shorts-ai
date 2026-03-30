import jwt from 'jsonwebtoken'

const KLING_API_BASE = 'https://api-singapore.klingai.com'

// JWT 토큰 생성
function generateKlingToken(): string {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: process.env.KLING_ACCESS_KEY_ID!,
    exp: now + 1800,
    nbf: now - 5,
  }
  const token = jwt.sign(payload, process.env.KLING_ACCESS_KEY_SECRET!, {
    algorithm: 'HS256',
    header: { alg: 'HS256', typ: 'JWT' },
  })
  console.log('[Kling Token]', token)
  return token
}

// 영상 생성 요청
export async function submitKlingJob(videoPrompt: string): Promise<string> {
  const token = generateKlingToken()

  const res = await fetch(`${KLING_API_BASE}/v1/videos/text2video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_name: 'kling-v1',
      prompt: videoPrompt,
      negative_prompt: 'blurry, low quality, distorted',
      cfg_scale: 0.5,
      mode: 'std',
      aspect_ratio: '9:16',
      duration: '10',
    }),
    signal: AbortSignal.timeout(30_000),
  })

  const responseText = await res.text()
  console.log('[Kling API Response]', res.status, responseText)  // ← 디버그 로그 추가

  if (!res.ok) {
    throw new Error(`Kling 요청 실패: ${res.status} - ${responseText}`)
  }

  const data = JSON.parse(responseText)
  if (data.code !== 0) {
    throw new Error(`Kling API 오류: ${data.message}`)
  }

  return data.data.task_id as string
}

// 영상 생성 상태 확인
export interface KlingJobResult {
  taskId: string
  status: 'submitted' | 'processing' | 'succeed' | 'failed'
  videoUrl?: string
  errorMessage?: string
}

export async function pollKlingJob(taskId: string): Promise<KlingJobResult> {
  const token = generateKlingToken()

  const res = await fetch(`${KLING_API_BASE}/v1/videos/text2video/${taskId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`Kling 상태 조회 실패: ${res.status}`)

  const data = await res.json()

  if (data.code !== 0) {
    throw new Error(`Kling API 오류: ${data.message}`)
  }

  const task = data.data
  const videoUrl = task.task_result?.videos?.[0]?.url

  return {
    taskId,
    status: task.task_status,
    videoUrl,
    errorMessage: task.task_status_msg,
  }
}