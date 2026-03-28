import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  yt_channel_id: string | null
  yt_channel_name: string | null
}

export interface CreditInfo {
  balance: number
  tier: string
  monthly_credit_limit: number
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchProfile() {
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 프로필 조회
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      // 구독 조회
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('tier, monthly_credit_limit')
        .eq('user_id', user.id)
        .single()

      // 크레딧 잔액 조회 (최신 거래 기준)
      const { data: creditData } = await supabase
        .from('credit_transactions')
        .select('balance_after')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      setProfile(profileData)
      setCreditInfo({
        balance: creditData?.balance_after ?? 0,
        tier: subData?.tier ?? 'free',
        monthly_credit_limit: subData?.monthly_credit_limit ?? 10,
      })
      setLoading(false)
    }

    fetchProfile()
  }, [])

  return { profile, creditInfo, loading }
}