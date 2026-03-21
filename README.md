# TheraLink - AI Receptionist for Therapy Practices

An AI-powered receptionist SaaS that answers calls 24/7, handles SMS scheduling, manages intake, and books appointments for therapy practices.

## Features

- **24/7 AI Voice Receptionist** - Vapi.ai voice AI answers calls with practice-specific personality
- **SMS Scheduling** - Two-way SMS booking and rescheduling via Twilio
- **Patient Intake** - AI collects patient information during intake calls
- **Call & Message Logs** - Full dashboard with call transcripts and SMS history
- **Practice Settings** - Customize AI name, business hours, insurance plans
- **Appointment Management** - View and manage upcoming appointments
- **Multi-tenant SaaS** - Each therapy practice has isolated, secure data
- **Stripe Billing** - Automatic subscription billing

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes, Node.js
- **Database**: Supabase (PostgreSQL) with Row Level Security
- **Voice AI**: Vapi.ai API
- **SMS**: Twilio
- **LLM**: Anthropic Claude (claude-sonnet-4-6)
- **Payments**: Stripe
- **Deployment**: Railway

## Prerequisites

Before you start, make sure you have:

1. **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
2. The following API accounts (all have free tiers):
   - **Supabase** - https://supabase.com
   - **Vapi.ai** - https://vapi.ai
   - **Twilio** - https://twilio.com
   - **Anthropic** - https://console.anthropic.com
   - **Stripe** - https://stripe.com (for payments)

## Setup Instructions

### Step 1: Install Node.js

Download and install Node.js from https://nodejs.org/ (choose LTS version).

Verify installation:
```bash
node --version
npm --version
```

### Step 2: Clone and Install Dependencies

```bash
# Clone the repository
git clone <your-repo-url>
cd theralink-app

# Install dependencies
npm install
```

### Step 3: Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Once created, go to SQL Editor and run the schema from `supabase/schema.sql`
3. Also run `supabase/seed.sql` to add sample data
4. Go to Settings > API to get your credentials:
   - `NEXT_PUBLIC_SUPABASE_URL` - your project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - anon public key
   - `SUPABASE_SERVICE_ROLE_KEY` - service role secret

### Step 4: Set Up Vapi.ai for Voice Calls

1. Sign up at [vapi.ai](https://vapi.ai)
2. Create a new assistant in the dashboard
3. Get your API key from Settings
4. Note your Assistant ID (you can create different assistants per practice)
5. Add to `.env.local`:
   - `VAPI_API_KEY` - your API key
   - `NEXT_PUBLIC_VAPI_ASSISTANT_ID` - the assistant ID

### Step 5: Set Up Twilio for SMS & Phone Numbers

1. Sign up at [twilio.com](https://twilio.com)
2. Create a trial account and get a free trial phone number
3. Go to Account > API Keys to get:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
4. Set your phone number as `TWILIO_PHONE_NUMBER` (format: +1234567890)
5. Configure the webhook:
   - Go to Phone Numbers > Your Number
   - Under "Messaging", set Webhook URL to: `https://your-domain.com/api/sms/inbound`
   - (When testing locally, use a tunnel service like ngrok)

### Step 6: Get Anthropic Claude API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Click "API Keys" in the sidebar
3. Create a new API key
4. Add to `.env.local`:
   - `ANTHROPIC_API_KEY` - your API key

### Step 7: Set Up Stripe (Optional, for Payments)

1. Sign up at [stripe.com](https://stripe.com)
2. Go to Developers > API Keys
3. Copy your keys:
   - `STRIPE_SECRET_KEY` - secret key (starts with `sk_`)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - publishable key (starts with `pk_`)
4. For webhooks, use the CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`

### Step 8: Create `.env.local`

Copy `.env.example` to `.env.local` and fill in all your API keys:

```bash
cp .env.example .env.local
# Then edit .env.local with your keys
```

### Step 9: Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Step 10: Test the Full Flow

1. **Sign up** a practice at `/onboard`
2. **Configure** practice name, AI name, and business hours
3. **View dashboard** at `/dashboard`
4. **Make a test call** to the Twilio number to hear the AI receptionist
5. **Send a test SMS** to schedule an appointment

## File Structure

```
theralink-app/
├── app/
│   ├── api/                    # API routes (webhooks, CRUD)
│   │   ├── vapi/webhook/
│   │   ├── sms/inbound
│   │   ├── sms/send
│   │   ├── stripe/webhook
│   │   └── practices/
│   ├── dashboard/              # Admin dashboard
│   │   ├── calls/
│   │   ├── messages/
│   │   ├── settings/
│   │   └── page.tsx
│   ├── onboard/                # Onboarding flow
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Home/redirect
├── components/                 # React components
│   ├── Sidebar.tsx
│   ├── StatsCard.tsx
│   └── ...
├── lib/                        # Utilities & helpers
│   ├── supabase.ts             # Supabase client
│   ├── twilio.ts               # Twilio helpers
│   ├── claude.ts               # Anthropic client
│   ├── ai-prompts.ts           # System prompts
│   └── stripe.ts               # Stripe client
├── types/                      # TypeScript definitions
├── supabase/                   # Database schema & seeds
│   ├── schema.sql
│   └── seed.sql
├── package.json
├── tsconfig.json
└── .env.example
```

## Deployment to Railway

1. Push code to GitHub
2. Go to [railway.app](https://railway.app)
3. Create new project > Deploy from GitHub repo
4. Add environment variables from `.env.local`
5. Set `NODE_ENV=production`
6. Deploy!

Railway will automatically detect Next.js and deploy correctly.

## Troubleshooting

### "Cannot find module" errors
```bash
rm -rf node_modules package-lock.json
npm install
```

### Supabase connection fails
- Check that `NEXT_PUBLIC_SUPABASE_URL` and keys are correct
- Verify database tables exist by running schema.sql

### Twilio SMS not working
- Verify `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are correct
- Check that webhook URL in Twilio dashboard matches your app URL
- For local testing, use ngrok: `ngrok http 3000`

### Vapi voice calls not working
- Check that `VAPI_API_KEY` is valid
- Verify assistant is configured in Vapi dashboard
- Test in Vapi's web interface first

## Support

For issues or questions:
1. Check logs in your deployment service (Railway, Vercel, etc.)
2. Review Supabase dashboard for database errors
3. Check Vapi, Twilio, and Anthropic dashboards for rate limits/errors
4. Read through the code comments for implementation details

## License

Proprietary - TheraLink
