const PEXELS_API_BASE = 'https://api.pexels.com/videos'

export interface PexelsVideo {
  id: number
  url: string
  duration: number
  videoFiles: {
    link: string
    quality: string
    width: number
    height: number
  }[]
}

export async function searchPexelsVideos(
  keywords: string[],
  count: number = 5
): Promise<PexelsVideo[]> {
  const results: PexelsVideo[] = []

  for (const keyword of keywords) {
    const res = await fetch(
      `${PEXELS_API_BASE}/search?query=${encodeURIComponent(keyword)}&per_page=3&orientation=portrait`,
      {
        headers: {
          Authorization: process.env.PEXELS_API_KEY!,
        },
      }
    )

    if (!res.ok) continue

    const data = await res.json()
    const videos = data.videos ?? []

    for (const video of videos) {
      // HD 세로형 영상 파일 선택
      const videoFile = video.video_files?.find(
        (f: any) => f.quality === 'hd' && f.height > f.width
      ) ?? video.video_files?.[0]

      if (videoFile) {
        results.push({
          id: video.id,
          url: video.url,
          duration: video.duration,
          videoFiles: video.video_files,
        })
      }

      if (results.length >= count) break
    }

    if (results.length >= count) break
  }

  return results
}

export function getBestVideoFile(video: PexelsVideo): string {
  // 세로형 HD 우선
  const hdPortrait = video.videoFiles.find(
    f => f.quality === 'hd' && f.height > f.width
  )
  // HD
  const hd = video.videoFiles.find(f => f.quality === 'hd')
  // SD
  const sd = video.videoFiles.find(f => f.quality === 'sd')

  return (hdPortrait ?? hd ?? sd ?? video.videoFiles[0]).link
}