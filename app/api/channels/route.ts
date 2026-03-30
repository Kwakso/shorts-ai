import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 채널 목록 조회
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data } = await supabase
    .from('youtube_channels')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ channels: data ?? [] })
}

// 기본 채널 변경
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { channelId } = await req.json()

  // 모든 채널 기본값 해제
  await supabase
    .from('youtube_channels')
    .update({ is_default: false })
    .eq('user_id', user.id)

  // 선택한 채널 기본값 설정
  await supabase
    .from('youtube_channels')
    .update({ is_default: true })
    .eq('id', channelId)
    .eq('user_id', user.id)

  return NextResponse.json({ success: true })
}

// 채널 삭제
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { channelId } = await req.json()

  await supabase
    .from('youtube_channels')
    .delete()
    .eq('id', channelId)
    .eq('user_id', user.id)

  return NextResponse.json({ success: true })
}