import { useEffect, useRef } from 'react'

const POLL_INTERVAL = 30_000 // 30초마다
const MAX_ATTEMPTS = 40      // 최대 40회 (20분)

export function useVideoPolling(
  videos: Array<{ id: string; status: string; polling_attempts: number }>,
  onStatusChange: (id: string, status: string) => void
) {
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const generatingVideos = videos.filter(
      v => v.status === 'generating' && v.polling_attempts < MAX_ATTEMPTS
    )

    if (generatingVideos.length === 0) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    async function pollAll() {
      for (const video of generatingVideos) {
        try {
          const res = await fetch(`/api/videos/${video.id}/poll`)
          const data = await res.json()

          if (data.status && data.status !== 'generating') {
            onStatusChange(video.id, data.status)
          }
        } catch (err) {
          console.error(`폴링 실패 (${video.id}):`, err)
        }
      }
    }

    // 즉시 1회 실행
    pollAll()

    // 30초마다 반복
    timerRef.current = setInterval(pollAll, POLL_INTERVAL)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [videos, onStatusChange])
}