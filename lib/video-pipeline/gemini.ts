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
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-04-17' })

  const prompt = `
당신은 YouTube Shorts 전문 콘텐츠 크리에이터입니다.
다음 주제로 ${style} 스타일의 쇼츠 영상 콘텐츠를 만들어주세요.

주제: "${topic}"
언어: ${language === 'ko' ? '한국어' : 'English'}

반드시 아래 JSON 형식으로만 응답하세요. 마크다운이나 코드블록 없이 순수 JSON만 출력하세요:
{
  "title": "흥미로운 제목 (최대 100자, #Shorts 해시태그 포함)",
  "description": "영상 설명 (최대 500자, 관련 해시태그 포함)",
  "script": "30~60초 분량의 나레이션 스크립트",
  "videoPrompt": "AI 영상 생성을 위한 상세한 영어 프롬프트. 세로형 9:16 비율. ${style} 스타일.",
  "tags": ["태그1", "태그2", "Shorts", "YouTubeShorts"]
}
`

  const result = await model.generateContent(prompt)
  const text = result.response.text().replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(text) as ScriptResult
  } catch {
    throw new Error(`Gemini 응답 파싱 실패: ${text.slice(0, 200)}`)
  }
}