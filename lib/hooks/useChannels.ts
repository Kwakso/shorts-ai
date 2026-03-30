import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'

export interface YoutubeChannel {
  id: string
  channel_id: string
  channel_name: string
  channel_thumbnail: string | null
  is_default: boolean
  created_at: string
}

export function useChannels() {
  const [channels, setChannels] = useState<YoutubeChannel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchChannels() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('youtube_channels')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })

      setChannels(data ?? [])
      setLoading(false)
    }

    fetchChannels()
  }, [])

  return { channels, loading, setChannels }
}