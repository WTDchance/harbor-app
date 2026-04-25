-- Add Kasa smart device fields to practices table
-- Used for patient check-in notifications (turns on a light/plug when patient texts "here")

ALTER TABLE public.practices
ADD COLUMN IF NOT EXISTS kasa_email TEXT,
ADD COLUMN IF NOT EXISTS kasa_password TEXT,
ADD COLUMN IF NOT EXISTS kasa_device_alias TEXT,
ADD COLUMN IF NOT EXISTS kasa_auto_off_minutes INTEGER DEFAULT 5;

-- Add comment for documentation
COMMENT ON COLUMN public.practices.kasa_email IS 'TP-Link/Kasa account email for smart device control';
COMMENT ON COLUMN public.practices.kasa_password IS 'TP-Link/Kasa account password (encrypted at app level)';
COMMENT ON COLUMN public.practices.kasa_device_alias IS 'Name of the Kasa device to trigger on check-in (must match device name in Kasa app)';
COMMENT ON COLUMN public.practices.kasa_auto_off_minutes IS 'Minutes before auto-turning off the device after check-in (default 5)';
