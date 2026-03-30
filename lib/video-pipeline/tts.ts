import textToSpeech from '@google-cloud/text-to-speech'

const client = new textToSpeech.TextToSpeechClient({
  apiKey: process.env.GOOGLE_TTS_API_KEY!,
})

export interface TTSResult {
  audioBuffer: Buffer
}

export async function generateTTS(
  text: string,
  language: string = 'ko'
): Promise<TTSResult> {
  const languageCode = language === 'ko' ? 'ko-KR' : 'en-US'
  const voiceName = language === 'ko' ? 'ko-KR-Neural2-A' : 'en-US-Neural2-F'

  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode,
      name: voiceName,
      ssmlGender: 'FEMALE',
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 1.1,
      pitch: 0,
      volumeGainDb: 2.0,
    },
  })

  if (!response.audioContent) {
    throw new Error('TTS 음성 생성 실패')
  }

  const audioBuffer = Buffer.from(response.audioContent as Uint8Array)
  return { audioBuffer }
}