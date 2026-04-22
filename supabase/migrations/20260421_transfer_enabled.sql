-- Per-practice toggle for whether Ellie is allowed to warm-transfer callers
-- mid-conversation to the therapist's phone. Independent from
-- forwarding_enabled: forwarding diverts calls before Ellie picks up,
-- transfer happens after Ellie has answered and screened the caller.
--
-- Default false: transfers are opt-in. Therapists must explicitly enable.
-- When false, the transferCall tool is not registered on the Vapi assistant
-- and Ellie defaults to takeMessage (she's instructed never to advertise
-- transfer when the capability is disabled).

alter table practices
  add column if not exists transfer_enabled boolean not null default false;

comment on column practices.transfer_enabled is
  'When true AND call_forwarding_number is set, Ellie may warm-transfer callers to that number during a live call. Independent from forwarding_enabled.';
