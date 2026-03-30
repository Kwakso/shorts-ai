import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export interface ScriptResult {
  title: string
  description: string
  script: string
  videoPrompt: string
  tags: string[]
}

export async function generateVideoScript(
  topic: string,
  style: string,
  language: string = 'ko'
): Promise<ScriptResult> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.8,
      responseMimeType: 'application/json',  // JSON 응답 강제
    },
  })

  const prompt = `당신은 YouTube Shorts 전문 콘텐츠 크리에이터이자 AI 영상 프롬프트 전문가입니다.
다음 주제로 바이럴 가능성이 높은 ${style} 스타일의 쇼츠 콘텐츠를 만들어주세요.

주제: "${topic}"
언어: ${language === 'ko' ? '한국어' : 'English'}

아래 JSON 형식으로만 응답하세요:
{
  "title": "클릭을 유도하는 흥미로운 제목 (최대 80자, #Shorts 포함)",
  "description": "영상 설명 (최대 400자, 관련 해시태그 5개 이상 포함)",
  "script": "30~45초 분량의 자연스러운 나레이션 스크립트. 첫 3초가 핵심이어야 함.",
  "videoPrompt": "Vertical 9:16 format. ${style} style. Ultra detailed cinematic AI video generation prompt in English. Describe: main subject, lighting, camera movement, color grading, background, mood, visual details. Minimum 80 words.",
  "tags": ["한국어태그1", "한국어태그2", "Shorts", "YouTubeShorts", "쇼츠"]
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text().replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(text) as ScriptResult
  } catch {
    throw new Error(`Gemini 응답 파싱 실패: ${text.slice(0, 500)}`)
  }
}