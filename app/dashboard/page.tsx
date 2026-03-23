'use client'
import { useEffect, useState } from 'react'
import { Phone, Clock, Users, TrendingUp, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

interface RecentCall {
    id: string
    patient_phone: string
    duration_seconds: number
    summary: string | null
    transcript: string | null
    crisis_detected?: boolean
    created_at: string
}

interface PatientArrival {
    id: string
    patient_name: string | null
    patient_phone: string
    arrived_at: string
    therapist_notified: boolean
}

function formatDuration(s: number) {
    if (!s) return '0:00'
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function RecentCallCard({ call }: { call: RecentCall }) {
    const [expanded, setExpanded] = useState(false)
    return (
          <div className="border-b border-gray-100 last:border-b-0">
                <div
                          className="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                          onClick={() => setExpanded(!expanded)}
                        >
                        <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                  <Phone className="w-3.5 h-3.5 text-teal-600" />
                        </div>div>
                        <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                              <div className="flex items-center gap-2">
                                                            <p className="font-medium text-gray-900 text-sm">{call.patient_phone}</p>p>
                                                {call.crisis_detected && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                                                            <AlertCircle className="w-3 h-3" />
                                                            Crisis
                                          </span>span>
                                                            )}
                                              </div>div>
                                              <div className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
                                                            <span>{formatDuration(call.duration_seconds)}</span>span>
                                                            <span>·</span>span>
                                                            <span>{timeAgo(call.created_at)}</span>span>
                                                {expanded ? (
                                          <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                                        ) : (
                                          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                        )}
                                              </div>div>
                                  </div>div>
                          {call.summary && (
                                      <p className={`text-sm text-gray-500 mt-0.5 ${expanded ? '' : 'truncate'}`}>
                                        {call.summary}
                                      </p>p>
                                  )}
                        </div>div>
                </div>div>
            {expanded && (
                    <div className="px-5 pb-4 pt-0 space-y-3 bg-gray-50">
                      {call.summary && (
                                  <div>
                                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">AI Summary</p>p>
                                                <p className="text-sm text-gray-700 bg-teal-50 rounded-lg p-3">{call.summary}</p>p>
                                  </div>div>
                              )}
                      {call.transcript && (
                                  <div>
                                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Transcript</p>p>
                                                <pre className="text-xs text-gray-600 bg-white rounded-lg p-3 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto border border-gray-200">
                                                  {call.transcript}
                                                </pre>pre>
                                  </div>div>
                              )}
                    </div>div>
                )}
          </div>div>
        )
}

export default function DashboardPage() {
    const [practiceName, setPracticeName] = useState('')
        const [practice, setPractice] = useState<any>(null)
            const [recentCalls, setRecentCalls] = useState<RecentCall[]>([])
                const [arrivals, setArrivals] = useState<PatientArrival[]>([])
                    const [stats, setStats] = useState({ today: 0, avgDuration: 0, waitlist: 0, total: 0 })
                        const [loading, setLoading] = useState(true)
                            const supabase = createClient()
                              
                                useEffect(() => {
                                      const load = async () => {
                                              const { data: { user } } = await supabase.auth.getUser()
                                                      if (!user) { setLoading(false); return }
                                        
                                              const { data: practice } = await supabase
                                                        .from('practices')
                                                        .select('id, name, phone_number, ai_name')
                                                        .eq('notification_email', user.email)
                                                        .single()
                                                
                                                      if (!practice) { setLoading(false); return }
                                        
                                              setPracticeName(practice.name)
                                                      setPractice(practice)
                                                        
                                                              const todayStart = new Date()
                                                                      todayStart.setHours(0, 0, 0, 0)
                                                                        
                                                                              const [callsRes, todayRes, totalRes, waitlistRes, arrivalsRes] = await Promise.all([
                                                                                        supabase
                                                                                          .from('call_logs')
                                                                                          .select('id, patient_phone, duration_seconds, summary, transcript, crisis_detected, created_at')
                                                                                          .eq('practice_id', practice.id)
                                                                                          .order('created_at', { ascending: false })
                                                                                          .limit(5),
                                                                                        supabase
                                                                                          .from('call_logs')
                                                                                          .select('id, duration_seconds', { count: 'exact' })
                                                                                          .eq('practice_id', practice.id)
                                                                                          .gte('created_at', todayStart.toISOString()),
                                                                                        supabase
                                                                                          .from('call_logs')
                                                                                          .select('id', { count: 'exact', head: true })
                                                                                          .eq('practice_id', practice.id),
                                                                                        supabase
                                                                                          .from('waitlist')
                                                                                          .select('id', { count: 'exact' })
                                                                                          .eq('practice_id', practice.id)
                                                                                          .eq('status', 'waiting'),
                                                                                        supabase
                                                                                          .from('patient_arrivals')
                                                                                          .select('id, patient_name, patient_phone, arrived_at, therapist_notified')
                                                                                          .eq('practice_id', practice.id)
                                                                                          .gte('arrived_at', todayStart.toISOString())
                                                                                          .order('arrived_at', { ascending: false }),
                                                                                      ])
                                                                                
                                                                                      const todayCalls = todayRes.data || []
                                                                                              const avgDur = todayCalls.length
                                                                                                        ? Math.round(todayCalls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / todayCalls.length)
                                                                                                        : 0
                                                                                                
                                                                                                      setRecentCalls(callsRes.data || [])
                                                                                                              setArrivals(arrivalsRes.data || [])
                                                                                                                      setStats({
                                                                                                                                today: todayRes.count || 0,
                                                                                                                                avgDuration: avgDur,
                                                                                                                                waitlist: waitlistRes.count || 0,
                                                                                                                                total: totalRes.count || 0,
                                                                                                                        })
                                                                                                                              setLoading(false)
                                        }
                                            load()
                                }, [supabase])
                                  
                                    return (
                                          <div>
                                                <div className="mb-8">
                                                        <h1 className="text-2xl font-bold text-gray-900">
                                                          {practiceName || 'Dashboard'}
                                                        </h1>h1>
                                                        <p className="text-gray-500 mt-1">Here&apos;s what Ellie has been up to today</p>p>
                                                </div>div>
                                          
                                            {/* Ellie Status Card */}
                                            {!loading && (
                                                    <div className={`rounded-xl border p-4 mb-6 flex items-center justify-between ${
                                                                practice?.phone_number ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'
                                                    }`}>
                                                              <div className="flex items-center gap-3">
                                                                          <div className={`w-2.5 h-2.5 rounded-full ${practice?.phone_number ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                                                                          <div>
                                                                                        <p className={`font-medium text-sm ${practice?.phone_number ? 'text-green-800' : 'text-yellow-800'}`}>
                                                                                          {practice?.phone_number ? `${practice.ai_name || 'Ellie'} is live` : 'Phone number not configured'}
                                                                                          </p>p>
                                                                                        <p className={`text-xs mt-0.5 ${practice?.phone_number ? 'text-green-600' : 'text-yellow-600'}`}>
                                                                                          {practice?.phone_number
                                                                                                              ? `Answering calls at ${practice.phone_number}`
                                                                                                              : 'Contact Harbor support to activate your phone line'}
                                                                                          </p>p>
                                                                          </div>div>
                                                              </div>div>
                                                    </div>div>
                                                )}
                                          
                                            {/* Stats */}
                                                <div className="grid grid-cols-4 gap-4 mb-8">
                                                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                                                                  <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center mb-3">
                                                                              <Phone className="w-5 h-5 text-teal-600" />
                                                                  </div>div>
                                                                  <p className="text-2xl font-bold text-gray-900">{loading ? '—' : stats.today}</p>p>
                                                                  <p className="text-sm text-gray-500 mt-0.5">Calls Today</p>p>
                                                        </div>div>
                                                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                                                                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
                                                                              <Clock className="w-5 h-5 text-blue-600" />
                                                                  </div>div>
                                                                  <p className="text-2xl font-bold text-gray-900">{loading ? '—' : formatDuration(stats.avgDuration)}</p>p>
                                                                  <p className="text-sm text-gray-500 mt-0.5">Avg Duration</p>p>
                                                        </div>div>
                                                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                                                                  <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center mb-3">
                                                                              <Users className="w-5 h-5 text-orange-600" />
                                                                  </div>div>
                                                                  <p className="text-2xl font-bold text-gray-900">{loading ? '—' : stats.waitlist}</p>p>
                                                                  <p className="text-sm text-gray-500 mt-0.5">On Waitlist</p>p>
                                                        </div>div>
                                                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                                                                  <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center mb-3">
                                                                              <TrendingUp className="w-5 h-5 text-purple-600" />
                                                                  </div>div>
                                                                  <p className="text-2xl font-bold text-gray-900">{loading ? '—' : stats.total}</p>p>
                                                                  <p className="text-sm text-gray-500 mt-0.5">Total Calls</p>p>
                                                        </div>div>
                                                </div>div>
                                          
                                            {/* Today's Arrivals */}
                                                <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
                                                        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                                                  <span className="text-lg">🏥</span>span>
                                                                  Today's Arrivals
                                                        </h3>h3>
                                                  {arrivals.length === 0 ? (
                                                      <p className="text-sm text-gray-400">No arrivals yet today</p>p>
                                                    ) : (
                                                      <div className="space-y-2">
                                                        {arrivals.map(a => (
                                                                      <div key={a.id} className="flex items-center justify-between text-sm">
                                                                                      <span className="font-medium text-gray-700">{a.patient_name || a.patient_phone}</span>span>
                                                                                      <div className="flex items-center gap-2">
                                                                                                        <span className="text-gray-400">
                                                                                                          {new Date(a.arrived_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                                                                          </span>span>
                                                                                                        <span className={`w-2 h-2 rounded-full ${a.therapist_notified ? 'bg-green-500' : 'bg-yellow-400'}`} />
                                                                                        </div>div>
                                                                      </div>div>
                                                                    ))}
                                                      </div>div>
                                                        )}
                                                </div>div>
                                          
                                            {/* Recent Calls */}
                                                <div className="bg-white rounded-xl border border-gray-200">
                                                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                                                                  <h2 className="font-semibold text-gray-900">Recent Calls</h2>h2>
                                                                  <Link href="/dashboard/calls" className="text-sm text-teal-600 hover:underline">
                                                                              View all →
                                                                  </Link>Link>
                                                        </div>div>
                                                  {loading ? (
                                                      <div className="flex items-center justify-center h-32">
                                                                  <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
                                                      </div>div>
                                                    ) : recentCalls.length === 0 ? (
                                                      <div className="p-12 text-center">
                                                                  <Phone className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                                                                  <p className="text-gray-500 text-sm">No calls yet — Ellie is ready and waiting</p>p>
                                                      </div>div>
                                                    ) : (
                                                      <div>
                                                        {recentCalls.map(call => (
                                                                      <RecentCallCard key={call.id} call={call} />
                                                                    ))}
                                                      </div>div>
                                                        )}
                                                </div>div>
                                          </div>div>
                                        )
                                      }</div>
