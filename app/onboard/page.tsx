'use client'

import { OnboardingWizard } from '@/components/OnboardingWizard'
import { useRouter } from 'next/navigation'

export default function OnboardPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <OnboardingWizard
        onComplete={() => {
          router.push('/dashboard')
        }}
      />
    </div>
  )
}
