import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { useRef, useState } from 'react'

export function useFFmpeg() {
  const ffmpegRef = useRef(new FFmpeg())
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState(0)

  async function load() {
    if (loaded) return
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
    const ffmpeg = ffmpegRef.current

    ffmpeg.on('progress', ({ progress }) => {
      setProgress(Math.round(progress * 100))
    })

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    setLoaded(true)
  }

  async function composeVideo(
    videoUrl: string,
    audioUrl: string,
    videoId: string
  ): Promise<Blob> {
    await load()
    const ffmpeg = ffmpegRef.current

    // 파일 다운로드
    await ffmpeg.writeFile('input.mp4', await fetchFile(videoUrl))
    await ffmpeg.writeFile('audio.mp3', await fetchFile(audioUrl))

    // 영상 + 음성 합성
    // 영상 길이에 맞게 음성 루프 or 트림
    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-i', 'audio.mp3',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',       // 짧은 쪽 길이에 맞춤
      '-map', '0:v:0',
      '-map', '1:a:0',
      'output.mp4'
    ])

    const data = await ffmpeg.readFile('output.mp4')
    return new Blob([data as Uint8Array], { type: 'video/mp4' })
  }

  return { composeVideo, progress, loaded }
}