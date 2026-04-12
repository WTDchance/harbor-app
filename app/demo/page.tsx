'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const SCENES = [
  { step: 'Step 1', title: 'A new patient calls your practice', desc: 'Even at 9pm on a Saturday — Ellie picks up instantly.' },
  { step: 'Step 2', title: 'Ellie has a warm, natural conversation', desc: 'She answers questions, collects info, and makes the caller feel heard.' },
  { step: 'Step 3', title: 'Mental health screening happens live', desc: 'PHQ-2 and GAD-2 scores captured during the conversation — no awkward forms.' },
  { step: 'Step 4', title: 'Everything appears in your dashboard', desc: 'Call summary, patient info, scores, and transcript — all within seconds.' },
  { step: 'Step 5', title: 'Intake forms sent automatically', desc: 'Patient gets a text with a link to complete HIPAA consent and full screening.' },
  { step: 'Step 6', title: 'You never missed a thing', desc: 'From first ring to completed intake — all without lifting a finger.' },
]

const AUTO_DELAYS = [4000, 8000, 6000, 7000, 6000, 5000]

export default function DemoPage() {
  const [scene, setScene] = useState(0)
  const [auto, setAuto] = useState(true)
  const [key, setKey] = useState(0) // forces re-render for animations

  const next = useCallback(() => {
    if (scene >= SCENES.length - 1) { setScene(0); setKey(k => k + 1) }
    else { setScene(s => s + 1); setKey(k => k + 1) }
  }, [scene])

  const prev = useCallback(() => {
    if (scene > 0) { setScene(s => s - 1); setKey(k => k + 1) }
  }, [scene])

  const goTo = useCallback((i: number) => {
    setScene(i); setKey(k => k + 1)
  }, [])

  useEffect(() => {
    if (!auto) return
    if (scene >= SCENES.length - 1) { setAuto(false); return }
    const timer = setTimeout(next, AUTO_DELAYS[scene] || 5000)
    return () => clearTimeout(timer)
  }, [scene, auto, next])

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#f8fafc', minHeight: '100vh' }}>
      <style suppressHydrationWarning dangerouslySetInnerHTML={{ __html: [
        "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');",
        "@keyframes ringPulse { 0%{box-shadow:0 0 0 0 rgba(82,191,192,0.4);transform:scale(1)} 50%{box-shadow:0 0 0 20px rgba(82,191,192,0);transform:scale(1.05)} 100%{box-shadow:0 0 0 0 rgba(82,191,192,0);transform:scale(1)} }",
        "@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }",
        "@keyframes bubbleIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }",
        "@keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }",
        "@keyframes fillBar { from{width:0} }",
        "@keyframes scaleIn { from{transform:scale(0)} 50%{transform:scale(1.1)} to{transform:scale(1)} }",
        "@keyframes fadeSlideIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }",
        "@keyframes glow { 0%,100%{box-shadow:0 0 0 0 rgba(254,243,199,0)} 50%{box-shadow:0 0 8px 2px rgba(254,243,199,0.8)} }",
        ".bubble-1{animation:bubbleIn 0.4s ease 0.2s forwards}",
        ".bubble-2{animation:bubbleIn 0.4s ease 0.8s forwards}",
        ".bubble-3{animation:bubbleIn 0.4s ease 1.6s forwards}",
        ".bubble-4{animation:bubbleIn 0.4s ease 2.4s forwards}",
        ".bubble-5{animation:bubbleIn 0.4s ease 3.2s forwards}",
        ".bubble-6{animation:bubbleIn 0.4s ease 4.0s forwards}",
        ".bubble-7{animation:bubbleIn 0.4s ease 4.8s forwards}",
        ".score-1{animation:slideUp 0.4s ease forwards}",
        ".score-2{animation:slideUp 0.4s ease 0.3s forwards}",
        ".score-3{animation:slideUp 0.4s ease 0.6s forwards}",
        ".stat-1{animation:slideUp 0.4s ease 0.2s forwards}",
        ".stat-2{animation:slideUp 0.4s ease 0.4s forwards}",
        ".stat-3{animation:slideUp 0.4s ease 0.6s forwards}",
        ".field-1{animation:slideUp 0.3s ease 0.3s forwards}",
        ".field-2{animation:slideUp 0.3s ease 0.5s forwards}",
        ".field-3{animation:slideUp 0.3s ease 0.7s forwards}",
        ".field-4{animation:slideUp 0.3s ease 0.9s forwards}",
        ".field-5{animation:slideUp 0.3s ease 1.1s forwards}",
        ".field-6{animation:slideUp 0.3s ease 1.3s forwards}",
      ].join('\n') }}></style>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 48px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1f375d', marginBottom: 8 }}>See Harbor In Action</h1>
          <p style={{ fontSize: 15, color: '#6b7280', maxWidth: 500, margin: '0 auto' }}>Watch how a single phone call flows through the entire system — from ring to intake.</p>
        </div>

        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
          {SCENES.map((_, i) => (
            <div key={i} onClick={() => goTo(i)} style={{
              width: 48, height: 5, borderRadius: 3, cursor: 'pointer', transition: 'background 0.5s',
              background: i < scene ? '#1f375d' : i === scene ? '#52bfc0' : '#e5e7eb'
            }} />
          ))}
        </div>

        {/* Scene label */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1.5, color: '#52bfc0', marginBottom: 4 }}>{SCENES[scene].step}</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1f375d' }}>{SCENES[scene].title}</h2>
          <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>{SCENES[scene].desc}</div>
        </div>

        {/* Stage */}
        <div style={{ background: 'white', borderRadius: 20, boxShadow: '0 4px 24px rgba(31,55,93,0.08), 0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #e5e7eb', overflow: 'hidden', minHeight: 420 }}>
          <div key={key} style={{ animation: 'fadeSlideIn 0.5s ease both' }}>
            {scene === 0 && <Scene1 />}
            {scene === 1 && <Scene2 />}
            {scene === 2 && <Scene3 />}
            {scene === 3 && <Scene4 />}
            {scene === 4 && <Scene5 />}
            {scene === 5 && <Scene6 />}
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 24 }}>
          <button onClick={prev} disabled={scene === 0} style={{ padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: scene === 0 ? 'not-allowed' : 'pointer', border: '1px solid #e5e7eb', background: 'white', color: '#1f375d', opacity: scene === 0 ? 0.4 : 1 }}>&larr; Back</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ca3af', cursor: 'pointer' }}>
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} style={{ accentColor: '#52bfc0' }} /> Auto-play
          </label>
          <button onClick={next} style={{ padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none', background: '#1f375d', color: 'white' }}>{scene === SCENES.length - 1 ? 'Replay' : 'Next \u2192'}</button>
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'center', marginTop: 36, padding: 32, background: 'linear-gradient(135deg, #1f375d, #3e85af)', borderRadius: 16, color: 'white' }}>
          <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Ready to try it yourself?</h3>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 20 }}>Set up your AI receptionist in under 5 minutes.</p>
          <Link href="/signup" style={{ display: 'inline-block', background: 'white', color: '#1f375d', padding: '12px 28px', borderRadius: 10, fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>Get Started &rarr;</Link>
        </div>
      </div>
    </div>
  )
}

function Scene1() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: '48px 32px', textAlign: 'center', minHeight: 420, background: 'linear-gradient(135deg, #f0f9f9 0%, #fafbfc 100%)' }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'linear-gradient(135deg, #52bfc0, #3e85af)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, animation: 'ringPulse 1.5s ease infinite' }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="white"><path d="M20 15.5c-1.25 0-2.45-.2-3.57-.57a1.02 1.02 0 00-1.02.24l-2.2 2.2a15.045 15.045 0 01-6.59-6.59l2.2-2.2a.96.96 0 00.25-1A11.36 11.36 0 018.5 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.5c0-.55-.45-1-1-1z"/></svg>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#1f375d', marginBottom: 6 }}>Incoming Call</div>
      <div style={{ fontSize: 14, color: '#9ca3af', marginBottom: 24 }}>(503) 555-0147 &bull; Portland, OR</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#e8f8f8', color: '#52bfc0', padding: '6px 16px', borderRadius: 99, fontSize: 13, fontWeight: 600 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#52bfc0', animation: 'blink 1.2s ease infinite' }} />
        Ellie is answering...
      </div>
    </div>
  )
}

function Scene2() {
  return (
    <div style={{ display: 'flex', minHeight: 420 }}>
      <div style={{ flex: '0 0 200px', background: 'linear-gradient(180deg, #1f375d, #2a4a7a)', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'white' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, marginBottom: 10, border: '2px solid rgba(255,255,255,0.2)' }}>E</div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Ellie</div>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 20 }}>AI Receptionist</div>
        <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', opacity: 0.9 }}>1:24</div>
        <div style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase' as const, letterSpacing: 1, marginTop: 2 }}>Call Duration</div>
        <div style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, background: 'rgba(82,191,192,0.2)', color: '#52bfc0', padding: '4px 12px', borderRadius: 99 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#52bfc0', animation: 'blink 1.2s ease infinite' }} /> Live
        </div>
      </div>
      <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', background: '#fafbfc' }}>
        {[
          { who: 'ELLIE', side: 'ellie', text: 'Thank you for calling Hope and Harmony Counseling. This is Ellie, how can I help you today?' },
          { who: 'CALLER', side: 'patient', text: "Hi, I've been feeling really anxious lately and I think I need to talk to someone. Do you take Blue Cross?" },
          { who: 'ELLIE', side: 'ellie', text: "I'm glad you reached out — that takes courage. Yes, we do accept Blue Cross Blue Shield. Dr. Trace specializes in anxiety and has openings this week. Can I get your name?" },
          { who: 'CALLER', side: 'patient', text: 'Sarah Mitchell. Do you have anything Thursday afternoon?' },
          { who: 'ELLIE', side: 'ellie', text: 'Let me check for you, Sarah. Before I do — just so we can best prepare, on a scale of 0 to 3, how often have you been feeling nervous or on edge in the past two weeks?' },
          { who: 'CALLER', side: 'patient', text: "Probably a 2... it's been pretty constant." },
          { who: 'ELLIE', side: 'ellie', text: "Thank you for sharing that, Sarah. I have Thursday at 2:00 PM available. Would you like me to note that for Dr. Trace? I can also send you our intake forms by text." },
        ].map((b, i) => (
          <div key={i} className={`bubble-${i + 1}`} style={{
            maxWidth: '80%', padding: '12px 16px', borderRadius: 16, fontSize: 13, lineHeight: 1.5, opacity: 0,
            alignSelf: b.side === 'ellie' ? 'flex-start' : 'flex-end',
            background: b.side === 'ellie' ? 'white' : '#1f375d',
            color: b.side === 'ellie' ? '#374151' : 'white',
            border: b.side === 'ellie' ? '1px solid #e5e7eb' : 'none',
            borderBottomLeftRadius: b.side === 'ellie' ? 4 : 16,
            borderBottomRightRadius: b.side === 'patient' ? 4 : 16,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: b.side === 'ellie' ? '#52bfc0' : 'rgba(255,255,255,0.6)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{b.who}</div>
            {b.text}
          </div>
        ))}
      </div>
    </div>
  )
}

function Scene3() {
  const scores = [
    { label: 'PHQ-2 (Depression Screen)', num: '3', sev: 'Mild', sevBg: '#fef3c7', sevColor: '#92400e', color: '#52bfc0', pct: 37 },
    { label: 'GAD-2 (Anxiety Screen)', num: '4', sev: 'Moderate', sevBg: '#fff7ed', sevColor: '#c2410c', color: '#3e85af', pct: 67 },
    { label: 'Crisis Screen', num: 'Clear', sev: 'No risk detected', sevBg: '#f0fdf4', sevColor: '#16a34a', color: '#22c55e', pct: 0 },
  ]
  const profile = [
    ['Name', 'Sarah Mitchell'], ['Phone', '(503) 555-0147'], ['Insurance', 'Blue Cross Blue Shield'],
    ['Concern', 'Anxiety — constant nervousness'], ['Requested', 'Thursday 2:00 PM'], ['Intake preference', 'Text message'],
  ]
  return (
    <div style={{ padding: 32, minHeight: 420, display: 'flex', gap: 24 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>Captured during the conversation:</div>
        {scores.map((s, i) => (
          <div key={i} className={`score-${i + 1}`} style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16, opacity: 0 }}>
            <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.num}</div>
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: s.sevBg, color: s.sevColor }}>{s.sev}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#e5e7eb', marginTop: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: s.color, animation: 'fillBar 1s ease forwards', width: `${s.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex: '0 0 280px', background: '#f9fafb', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#1f375d', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 16 }}>Patient Profile</h3>
        {profile.map(([q, a]) => (
          <div key={q} style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 3 }}>{q}</div>
            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{a}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Scene4() {
  const navItems = ['Overview', 'Appointments', 'Patients', 'Intake', 'Calls', 'Crisis Alerts']
  return (
    <div style={{ display: 'flex', minHeight: 420 }}>
      <div style={{ flex: '0 0 180px', background: 'white', borderRight: '1px solid #f3f4f6', padding: '16px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#52bfc0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 800, marginBottom: 4 }}>H</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1f375d' }}>Harbor</div>
        </div>
        {navItems.map((n, i) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, marginBottom: 2, fontSize: 12, fontWeight: 500, color: i === 0 ? 'white' : '#6b7280', background: i === 0 ? '#1f375d' : 'transparent' }}>
            {i === 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#52bfc0' }} />}
            {n}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, background: '#f9fafb', padding: '20px 24px', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1f375d' }}>Good morning, Dr. Trace</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 16 }}>Saturday, April 11</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          {[
            { icon: '\uD83D\uDCC5', num: '3', label: 'Appointments today', color: '#52bfc0', bg: '#e8f8f8' },
            { icon: '\uD83D\uDC64', num: '1', label: 'New patient', color: '#3e85af', bg: '#eff6ff' },
            { icon: '\u2B50', num: '0', label: 'Crisis alerts', color: '#22c55e', bg: '#f0fdf4' },
          ].map((s, i) => (
            <div key={i} className={`stat-${i + 1}`} style={{ background: 'white', borderRadius: 10, border: '1px solid #e5e7eb', padding: 14, opacity: 0 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, marginBottom: 8 }}>{s.icon}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.num}</div>
              <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden', opacity: 0, animation: 'slideUp 0.5s ease 0.8s forwards' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: '#1f375d' }}>Recent Calls</h3>
            <span style={{ fontSize: 11, color: '#52bfc0', fontWeight: 600 }}>View all &rarr;</span>
          </div>
          {[
            { init: 'SM', name: 'Sarah Mitchell', summary: 'Anxiety concerns, BCBS, requesting Thursday 2pm. PHQ-2: 3, GAD-2: 4.', time: 'Just now', isNew: true, bg: '#e8f8f8', color: '#52bfc0' },
            { init: 'JW', name: 'James Wilson', summary: 'Reschedule request — moving Friday 10am to next Monday.', time: '2h ago', isNew: false, bg: '#eff6ff', color: '#3e85af' },
            { init: 'LP', name: 'Lisa Park', summary: 'Insurance question — confirmed Aetna accepted, no copay.', time: 'Yesterday', isNew: false, bg: '#faf5ff', color: '#7c3aed' },
          ].map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: i < 2 ? '1px solid #f9fafb' : 'none' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: c.bg, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{c.init}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  {c.name} {c.isNew && <span style={{ fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 4, marginLeft: 4, animation: 'glow 2s ease infinite' }}>NEW</span>}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>{c.summary}</div>
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>{c.time}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Scene5() {
  const fields = [
    ['Full Name', 'Sarah Mitchell'], ['Date of Birth', '03/15/1991'], ['Emergency Contact', 'David Mitchell — (503) 555-0199'],
    ['PHQ-9 Score (Full Assessment)', '8 — Mild depression'], ['GAD-7 Score (Full Assessment)', '11 — Moderate anxiety'], ['HIPAA Consent', '\u2713 Signed electronically'],
  ]
  return (
    <div style={{ display: 'flex', minHeight: 420 }}>
      <div style={{ flex: '0 0 320px', background: 'linear-gradient(180deg, #f0f9f9, #fafbfc)', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ width: 240, background: 'white', borderRadius: 24, border: '2px solid #e5e7eb', boxShadow: '0 8px 32px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <div style={{ height: 24, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 60, height: 6, background: '#d1d5db', borderRadius: 3 }} />
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ background: '#e8f8f8', border: '1px solid rgba(82,191,192,0.2)', borderRadius: 12, padding: 12, fontSize: 12, color: '#374151', lineHeight: 1.5, opacity: 0, animation: 'slideUp 0.4s ease 0.5s forwards' }}>
              <div style={{ fontSize: 10, color: '#52bfc0', fontWeight: 700, marginBottom: 4 }}>Harbor &bull; Hope &amp; Harmony Counseling</div>
              Hi Sarah! Dr. Trace is looking forward to meeting you. Please complete your intake forms before your visit:
              <div style={{ display: 'block', textAlign: 'center', background: '#1f375d', color: 'white', padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 600, marginTop: 8, opacity: 0, animation: 'slideUp 0.4s ease 1s forwards' }}>Complete Intake Forms &rarr;</div>
            </div>
            <div style={{ textAlign: 'center', fontSize: 10, color: '#9ca3af', marginTop: 8, opacity: 0, animation: 'slideUp 0.4s ease 1.5s forwards' }}>Sent automatically after the call ended</div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1f375d', marginBottom: 4 }}>Patient Intake Form</h3>
        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>Sarah completes this on her phone before her appointment:</div>
        {fields.map(([label, value], i) => (
          <div key={label} className={`field-${i + 1}`} style={{ opacity: 0 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{label}</label>
            <div style={{ background: '#e8f8f8', border: '1px solid #52bfc0', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#374151' }}>{value}</div>
          </div>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280', marginBottom: 6 }}><span>Intake progress</span><span>100%</span></div>
          <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'linear-gradient(90deg, #52bfc0, #3e85af)', borderRadius: 4, animation: 'fillBar 1.5s ease 1.5s forwards', width: 0 }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Scene6() {
  const steps = [
    { num: '1', label: 'Call answered', bg: '#1f375d' },
    { num: '2', label: 'Screened', bg: '#3e85af' },
    { num: '3', label: 'Dashboard', bg: '#52bfc0' },
    { num: '4', label: 'Intake done', bg: '#22c55e' },
  ]
  return (
    <div style={{ padding: 32, minHeight: 420, textAlign: 'center', background: 'linear-gradient(180deg, #f0f9f9, white)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #52bfc0, #3e85af)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, animation: 'scaleIn 0.5s ease' }}>
        <svg width="36" height="36" viewBox="0 0 24 24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" stroke="white" fill="none"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#1f375d', marginBottom: 6 }}>Zero effort. Complete picture.</div>
      <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 28, maxWidth: 440 }}>From the moment Sarah called to a fully completed intake — Harbor handled every step while you focused on your clients.</div>
      <div style={{ display: 'flex', gap: 32, justifyContent: 'center', marginBottom: 28 }}>
        {[
          { num: '0:00', label: 'Your time spent', color: '#52bfc0' },
          { num: '1:47', label: 'Call duration', color: '#3e85af' },
          { num: '100%', label: 'Intake completed', color: '#1f375d' },
        ].map(s => (
          <div key={s.label}>
            <div style={{ fontSize: 32, fontWeight: 800, color: s.color }}>{s.num}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', maxWidth: 600, margin: '0 auto' }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', marginBottom: 6 }}>{s.num}</div>
              <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 500 }}>{s.label}</div>
            </div>
            {i < steps.length - 1 && <div style={{ flex: '0 0 40px', height: 2, background: s.bg, marginTop: -18 }} />}
          </div>
        ))}
      </div>
    </div>
  )
}
