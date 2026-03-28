import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'

export interface Video {
  id: string
  topic: string
  style: string
  status: string
  title: string | null
  youtube_url: string | null
  created_at: string
  polling_attempts: number
}

export function useVideos() {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function fetchVideos() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('videos')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      setVideos(data ?? [])
      setLoading(false)
    }

    fetchVideos()

    // Realtime 구독 — 영상 상태 변경 시 자동 업데이트
    const channel = supabase
      .channel('videos-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'videos' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setVideos(prev => [payload.new as Video, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            setVideos(prev =>
              prev.map(v => v.id === payload.new.id ? payload.new as Video : v)
            )
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return { videos, loading, setVideos }
}