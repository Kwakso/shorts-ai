const PEXELS_API_BASE = 'https://api.pexels.com/videos'

export interface PexelsVideoFile {
  link: string
  quality: string
  width: number
  height: number
  file_type: string
}

export interface PexelsVideo {
  id: number
  duration: number
  video_files: PexelsVideoFile[]
}

// 키워드로 스톡 영상 검색
export async function searchPexelsVideos(
  keywords: string[],
  count: number = 5
): Promise<PexelsVideo[]> {
  const results: PexelsVideo[] = []

  for (const keyword of keywords) {
    if (results.length >= count) break

    try {
      const res = await fetch(
        `${PEXELS_API_BASE}/search?query=${encodeURIComponent(keyword)}&per_page=5&orientation=portrait`,
        {
          headers: { Authorization: process.env.PEXELS_API_KEY! },
        }
      )
      if (!res.ok) continue

      const data = await res.json()
      const videos: PexelsVideo[] = data.videos ?? []

      for (const video of videos) {
        if (results.length >= count) break
        if (video.video_files?.length > 0) {
          results.push(video)
        }
      }
    } catch (err) {
      console.error(`[Pexels] 검색 실패 (${keyword}):`, err)
    }
  }

  return results
}

// 최적 영상 파일 URL 선택 (세로형 HD 우선)
export function getBestVideoFileUrl(video: PexelsVideo): string {
  const files = video.video_files

  // 1순위: 세로형 HD
  const hdPortrait = files.find(f => f.quality === 'hd' && f.height > f.width)
  if (hdPortrait) return hdPortrait.link

  // 2순위: HD
  const hd = files.find(f => f.quality === 'hd')
  if (hd) return hd.link

  // 3순위: SD
  const sd = files.find(f => f.quality === 'sd')
  if (sd) return sd.link

  return files[0].link
}