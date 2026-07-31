--
-- PostgreSQL database dump
--

\restrict 1YxAL4621MnpPFv0zzJ7Lg7EtPahEhldRRc6bZ0RAElURJy6yr7dACaynpCXEno

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ScheduledSessionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ScheduledSessionStatus" AS ENUM (
    'SCHEDULED',
    'LIVE',
    'ENDED',
    'CANCELLED'
);


--
-- Name: SessionLanguage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SessionLanguage" AS ENUM (
    'ENGLISH',
    'SPANISH'
);


--
-- Name: StaffRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."StaffRole" AS ENUM (
    'FACILITATOR',
    'OPERATOR',
    'ADMIN'
);


--
-- Name: TicketEntitlementState; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TicketEntitlementState" AS ENUM (
    'ISSUED',
    'BOUND',
    'REVOKED',
    'EXPIRED'
);


--
-- Name: TicketTier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TicketTier" AS ENUM (
    'GLOBAL_NORTH',
    'GLOBAL_SOUTH',
    'COMP',
    'SUPPORT_OVERRIDE'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: scheduled_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_sessions (
    id uuid NOT NULL,
    title text NOT NULL,
    description text,
    room_name text NOT NULL,
    language public."SessionLanguage" NOT NULL,
    scheduled_at timestamp(3) without time zone NOT NULL,
    started_at timestamp(3) without time zone,
    ended_at timestamp(3) without time zone,
    status public."ScheduledSessionStatus" DEFAULT 'SCHEDULED'::public."ScheduledSessionStatus" NOT NULL,
    paid_mode boolean DEFAULT true NOT NULL,
    attendee_cap integer DEFAULT 150 NOT NULL,
    max_publishers integer DEFAULT 6 NOT NULL,
    facilitator_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT scheduled_sessions_weekend_attendee_cap_check CHECK ((attendee_cap = 150)),
    CONSTRAINT scheduled_sessions_weekend_max_publishers_check CHECK ((max_publishers = 6)),
    CONSTRAINT scheduled_sessions_weekend_paid_mode_check CHECK ((paid_mode = true))
);


--
-- Name: session_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_participants (
    id uuid NOT NULL,
    scheduled_session_id uuid NOT NULL,
    participant_identity text NOT NULL,
    ticket_entitlement_id uuid,
    staff_user_id uuid,
    joined_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    left_at timestamp(3) without time zone,
    raised_at timestamp(3) without time zone,
    publish_granted_at timestamp(3) without time zone,
    publish_revoked_at timestamp(3) without time zone,
    grant_version integer DEFAULT 0 NOT NULL,
    grant_reconcile_needed boolean DEFAULT false NOT NULL,
    grant_changed_by_user_id uuid,
    grant_reason text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT session_participants_grant_version_check CHECK ((grant_version >= 0)),
    CONSTRAINT session_participants_one_principal_check CHECK (((((staff_user_id IS NOT NULL))::integer + ((ticket_entitlement_id IS NOT NULL))::integer) = 1))
);


--
-- Name: ticket_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_entitlements (
    id uuid NOT NULL,
    scheduled_session_id uuid NOT NULL,
    code_digest text NOT NULL,
    code_last_four character varying(4) NOT NULL,
    tier public."TicketTier" NOT NULL,
    state public."TicketEntitlementState" DEFAULT 'ISSUED'::public."TicketEntitlementState" NOT NULL,
    bound_email text,
    bound_at timestamp(3) without time zone,
    expires_at timestamp(3) without time zone NOT NULL,
    issued_by_user_id uuid,
    revoked_at timestamp(3) without time zone,
    revoked_by_user_id uuid,
    revocation_reason text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT ticket_entitlements_binding_check CHECK ((((state = 'BOUND'::public."TicketEntitlementState") AND (bound_email IS NOT NULL) AND (bound_at IS NOT NULL)) OR (state <> 'BOUND'::public."TicketEntitlementState"))),
    CONSTRAINT ticket_entitlements_bound_email_normalized_check CHECK (((bound_email IS NULL) OR (bound_email = lower(btrim(bound_email))))),
    CONSTRAINT ticket_entitlements_last_four_check CHECK ((char_length((code_last_four)::text) = 4)),
    CONSTRAINT ticket_entitlements_revocation_check CHECK ((((state = 'REVOKED'::public."TicketEntitlementState") AND (revoked_at IS NOT NULL) AND (revocation_reason IS NOT NULL)) OR (state <> 'REVOKED'::public."TicketEntitlementState")))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    role public."StaffRole" NOT NULL,
    password_digest text NOT NULL,
    disabled_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT users_email_normalized_check CHECK ((email = lower(btrim(email))))
);


--
-- Name: web_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.web_sessions (
    id uuid NOT NULL,
    token_digest text NOT NULL,
    staff_user_id uuid,
    ticket_entitlement_id uuid,
    expires_at timestamp(3) without time zone NOT NULL,
    last_seen_at timestamp(3) without time zone,
    revoked_at timestamp(3) without time zone,
    revoked_by_user_id uuid,
    revocation_reason text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT web_sessions_one_principal_check CHECK (((((staff_user_id IS NOT NULL))::integer + ((ticket_entitlement_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT web_sessions_revocation_check CHECK ((((revoked_at IS NULL) AND (revocation_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (revocation_reason IS NOT NULL))))
);


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
efe827a8-9dd6-4339-93b4-6ed4f0c98045	0ebfb48f939f53716f741c62751c82fcfe2f57c461896dc7127ce6ecf8b8eb0b	2026-07-31 00:47:03.783747+00	20260728120000_weekend_mvp	\N	\N	2026-07-31 00:47:03.708671+00	1
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, actor_user_id, action, target_type, target_id, reason, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: scheduled_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheduled_sessions (id, title, description, room_name, language, scheduled_at, started_at, ended_at, status, paid_mode, attendee_cap, max_publishers, facilitator_id, created_at, updated_at) FROM stdin;
10000000-0000-4000-8000-000000000101	Harmonic Projection — Sesión en Español (test)	Test fixture session. Spanish, Saturday 2026-08-01 08:30 Costa Rica.	weekend-test-spanish	SPANISH	2026-08-01 14:30:00	\N	\N	SCHEDULED	t	150	6	eb71e04c-5c0e-405c-8d3e-44928850bf66	2026-07-31 00:47:04.979	2026-07-31 00:47:04.979
10000000-0000-4000-8000-000000000102	Harmonic Projection — English Session (test)	Test fixture session. English, Saturday 2026-08-01 12:30 Costa Rica.	weekend-test-english	ENGLISH	2026-08-01 18:30:00	\N	\N	SCHEDULED	t	150	6	eb71e04c-5c0e-405c-8d3e-44928850bf66	2026-07-31 00:47:05.031	2026-07-31 00:47:05.031
\.


--
-- Data for Name: session_participants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.session_participants (id, scheduled_session_id, participant_identity, ticket_entitlement_id, staff_user_id, joined_at, left_at, raised_at, publish_granted_at, publish_revoked_at, grant_version, grant_reconcile_needed, grant_changed_by_user_id, grant_reason, created_at, updated_at) FROM stdin;
78fc51b7-9b11-47f4-b4b0-2a61f1265f69	10000000-0000-4000-8000-000000000101	test-facilitator-identity	\N	eb71e04c-5c0e-405c-8d3e-44928850bf66	2026-07-31 00:47:04.993	\N	\N	2026-07-31 00:47:04.991	\N	0	f	eb71e04c-5c0e-405c-8d3e-44928850bf66	Test fixture facilitator baseline grant	2026-07-31 00:47:04.993	2026-07-31 00:47:04.993
b7f7b367-d205-4da1-bae6-6d69b8373620	10000000-0000-4000-8000-000000000102	test-facilitator-identity	\N	eb71e04c-5c0e-405c-8d3e-44928850bf66	2026-07-31 00:47:05.036	\N	\N	2026-07-31 00:47:05.035	\N	0	f	eb71e04c-5c0e-405c-8d3e-44928850bf66	Test fixture facilitator baseline grant	2026-07-31 00:47:05.036	2026-07-31 00:47:05.036
\.


--
-- Data for Name: ticket_entitlements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ticket_entitlements (id, scheduled_session_id, code_digest, code_last_four, tier, state, bound_email, bound_at, expires_at, issued_by_user_id, revoked_at, revoked_by_user_id, revocation_reason, created_at, updated_at) FROM stdin;
99966da8-5486-4af8-bd43-e778c6a62881	10000000-0000-4000-8000-000000000101	afc5be47bc7dc5d8145a0b1b55f94ea7b1821cd54e4b70b8bfba2e8637e85b36	000A	GLOBAL_SOUTH	ISSUED	\N	\N	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.002	2026-07-31 00:47:05.002
db94f38d-3f62-43d2-aac8-16ff1ddf963d	10000000-0000-4000-8000-000000000101	9a052432fcd2016500d03c517b0342f055b2350e2f046ca42372d2364b8156e7	000B	GLOBAL_SOUTH	ISSUED	\N	\N	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.008	2026-07-31 00:47:05.008
01810030-0245-4885-90ab-671ef66b401e	10000000-0000-4000-8000-000000000101	3ed6e2ad37b93eee7ab30bd3b2241d3869f49875e17b34b5747a0a321fc1fea1	000C	GLOBAL_SOUTH	ISSUED	\N	\N	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.013	2026-07-31 00:47:05.013
54fe7bf4-3787-4eb9-aa84-5acba9226f1a	10000000-0000-4000-8000-000000000101	075130c8a1134d0133efc1a70cdf65b6af3a2d7d36ad3e8e3b38870233777c80	000D	GLOBAL_SOUTH	BOUND	asistente@test.beacon	2026-07-31 00:47:05.017	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.018	2026-07-31 00:47:05.018
d3dd874e-7abd-46fb-8ba7-f15a0f6e3e14	10000000-0000-4000-8000-000000000101	84851a44fa79b203442838634ee29cd349f4efeb37c34f32cb08c27f69275d44	000E	GLOBAL_SOUTH	REVOKED	\N	\N	2026-08-02 14:30:00	\N	2026-07-31 00:47:05.021	\N	Test fixture revoked ticket	2026-07-31 00:47:05.023	2026-07-31 00:47:05.023
f1fab8fd-9bbf-4877-abd1-9462ce2e3c78	10000000-0000-4000-8000-000000000101	6f87e2340b402e5c9f9ab1f08d1c20f7075608b5d94a6ba821529465c6fb9d51	000F	COMP	ISSUED	\N	\N	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.027	2026-07-31 00:47:05.027
1b20ca77-684f-40f2-b73b-c9a843a88124	10000000-0000-4000-8000-000000000102	90882bd4abb370c2f917afca9f1040517062d3f76afa1daf3d2fae95d6cf4a9a	001A	GLOBAL_NORTH	ISSUED	\N	\N	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.04	2026-07-31 00:47:05.04
2e72d2c1-5457-44a2-ae01-fd759b8833f8	10000000-0000-4000-8000-000000000102	2359fc7c504c08dcd1d42a328a4ad9f364c49d338356eb6d38d22b925ebdb83f	001B	GLOBAL_NORTH	ISSUED	\N	\N	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.045	2026-07-31 00:47:05.045
e8da795d-2358-4764-850b-851db34d28d9	10000000-0000-4000-8000-000000000102	f065955cf7757cb5eb683bc567aec8621a626e6bcc0543e57ab10af865a32927	001C	GLOBAL_NORTH	ISSUED	\N	\N	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.048	2026-07-31 00:47:05.048
efe3a3fc-c46c-41c8-b6ed-bb17b571c2fa	10000000-0000-4000-8000-000000000102	16b4264e91d31c0d649c9036fc0b9039eefc3b85909f4b5f3a5c1b339bc0f0cd	001D	GLOBAL_NORTH	BOUND	attendee@test.beacon	2026-07-31 00:47:05.051	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.052	2026-07-31 00:47:05.052
e1c2ebc9-9d0d-48bd-936e-574c2e42cf20	10000000-0000-4000-8000-000000000102	4b0e82577b200c05e77143fe6c0873c3c28081b1a5f47a1bd5532e406b061b2d	001E	GLOBAL_NORTH	REVOKED	\N	\N	2026-08-02 18:30:00	\N	2026-07-31 00:47:05.054	\N	Test fixture revoked ticket	2026-07-31 00:47:05.055	2026-07-31 00:47:05.055
e34280d8-acf8-4240-bdc0-046e442de09e	10000000-0000-4000-8000-000000000102	793443a62f57a0cee0bdeb347ca1916dc8a731d3cfb028cca091c134a2ed74f6	001F	COMP	ISSUED	\N	\N	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 00:47:05.059	2026-07-31 00:47:05.059
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, name, role, password_digest, disabled_at, created_at, updated_at) FROM stdin;
eb71e04c-5c0e-405c-8d3e-44928850bf66	facilitator@test.beacon	Test Facilitator	FACILITATOR	scrypt$Zml4dHVyZS1zYWx0LWZhYzAx$YB4mTzvK9c6bopNNFRVz2TVvtVAElu6v58-geir3Vvc	\N	2026-07-31 00:47:04.79	2026-07-31 00:47:04.79
6b43eee3-46ab-4065-b191-87b38ce98229	operator1@test.beacon	Test Operator One	OPERATOR	scrypt$Zml4dHVyZS1zYWx0LW9wMDAx$Zf4xXnLOsV-mF3HANjmOmh7K9viVI5NgpbnmMYf6TO8	\N	2026-07-31 00:47:04.854	2026-07-31 00:47:04.854
eaa6236a-7a8d-4b87-bf59-2d4bdefd84ea	operator2@test.beacon	Test Operator Two	OPERATOR	scrypt$Zml4dHVyZS1zYWx0LW9wMDAy$ua1yfWxwDYrpb3t8_9LJlzlhNWLIisM4mJy-AQ5WOdI	\N	2026-07-31 00:47:04.909	2026-07-31 00:47:04.909
064024b4-17f6-4014-9ef4-a4cc8dcc5cc6	admin@test.beacon	Test Admin	ADMIN	scrypt$Zml4dHVyZS1zYWx0LWFkbTAx$kSd1m-XyTYTZvI1N_z7XOmmlc8-gVXf7ulIzRcIohvg	\N	2026-07-31 00:47:04.964	2026-07-31 00:47:04.964
\.


--
-- Data for Name: web_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.web_sessions (id, token_digest, staff_user_id, ticket_entitlement_id, expires_at, last_seen_at, revoked_at, revoked_by_user_id, revocation_reason, created_at) FROM stdin;
\.


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: scheduled_sessions scheduled_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_sessions
    ADD CONSTRAINT scheduled_sessions_pkey PRIMARY KEY (id);


--
-- Name: session_participants session_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_pkey PRIMARY KEY (id);


--
-- Name: ticket_entitlements ticket_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_entitlements
    ADD CONSTRAINT ticket_entitlements_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: web_sessions web_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_sessions
    ADD CONSTRAINT web_sessions_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at);


--
-- Name: audit_logs_target_type_target_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_target_type_target_id_idx ON public.audit_logs USING btree (target_type, target_id);


--
-- Name: scheduled_sessions_room_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX scheduled_sessions_room_name_key ON public.scheduled_sessions USING btree (room_name);


--
-- Name: scheduled_sessions_status_scheduled_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduled_sessions_status_scheduled_at_idx ON public.scheduled_sessions USING btree (status, scheduled_at);


--
-- Name: session_participants_scheduled_session_id_participant_identity_; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX session_participants_scheduled_session_id_participant_identity_ ON public.session_participants USING btree (scheduled_session_id, participant_identity);


--
-- Name: session_participants_scheduled_session_id_publish_granted_at_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_participants_scheduled_session_id_publish_granted_at_id ON public.session_participants USING btree (scheduled_session_id, publish_granted_at);


--
-- Name: session_participants_scheduled_session_id_raised_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_participants_scheduled_session_id_raised_at_idx ON public.session_participants USING btree (scheduled_session_id, raised_at);


--
-- Name: session_participants_scheduled_session_id_staff_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX session_participants_scheduled_session_id_staff_user_id_key ON public.session_participants USING btree (scheduled_session_id, staff_user_id) WHERE (staff_user_id IS NOT NULL);


--
-- Name: session_participants_scheduled_session_id_ticket_entitlement_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX session_participants_scheduled_session_id_ticket_entitlement_id ON public.session_participants USING btree (scheduled_session_id, ticket_entitlement_id) WHERE (ticket_entitlement_id IS NOT NULL);


--
-- Name: ticket_entitlements_bound_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_entitlements_bound_email_idx ON public.ticket_entitlements USING btree (bound_email);


--
-- Name: ticket_entitlements_code_digest_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ticket_entitlements_code_digest_key ON public.ticket_entitlements USING btree (code_digest);


--
-- Name: ticket_entitlements_code_last_four_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_entitlements_code_last_four_idx ON public.ticket_entitlements USING btree (code_last_four);


--
-- Name: ticket_entitlements_scheduled_session_id_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_entitlements_scheduled_session_id_state_idx ON public.ticket_entitlements USING btree (scheduled_session_id, state);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: web_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX web_sessions_expires_at_idx ON public.web_sessions USING btree (expires_at);


--
-- Name: web_sessions_staff_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX web_sessions_staff_user_id_idx ON public.web_sessions USING btree (staff_user_id);


--
-- Name: web_sessions_ticket_entitlement_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX web_sessions_ticket_entitlement_id_idx ON public.web_sessions USING btree (ticket_entitlement_id);


--
-- Name: web_sessions_token_digest_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX web_sessions_token_digest_key ON public.web_sessions USING btree (token_digest);


--
-- Name: audit_logs audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: scheduled_sessions scheduled_sessions_facilitator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_sessions
    ADD CONSTRAINT scheduled_sessions_facilitator_id_fkey FOREIGN KEY (facilitator_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: session_participants session_participants_grant_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_grant_changed_by_user_id_fkey FOREIGN KEY (grant_changed_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: session_participants session_participants_scheduled_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_scheduled_session_id_fkey FOREIGN KEY (scheduled_session_id) REFERENCES public.scheduled_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: session_participants session_participants_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_staff_user_id_fkey FOREIGN KEY (staff_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: session_participants session_participants_ticket_entitlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_ticket_entitlement_id_fkey FOREIGN KEY (ticket_entitlement_id) REFERENCES public.ticket_entitlements(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ticket_entitlements ticket_entitlements_issued_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_entitlements
    ADD CONSTRAINT ticket_entitlements_issued_by_user_id_fkey FOREIGN KEY (issued_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ticket_entitlements ticket_entitlements_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_entitlements
    ADD CONSTRAINT ticket_entitlements_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ticket_entitlements ticket_entitlements_scheduled_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_entitlements
    ADD CONSTRAINT ticket_entitlements_scheduled_session_id_fkey FOREIGN KEY (scheduled_session_id) REFERENCES public.scheduled_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: web_sessions web_sessions_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_sessions
    ADD CONSTRAINT web_sessions_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: web_sessions web_sessions_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_sessions
    ADD CONSTRAINT web_sessions_staff_user_id_fkey FOREIGN KEY (staff_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: web_sessions web_sessions_ticket_entitlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_sessions
    ADD CONSTRAINT web_sessions_ticket_entitlement_id_fkey FOREIGN KEY (ticket_entitlement_id) REFERENCES public.ticket_entitlements(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 1YxAL4621MnpPFv0zzJ7Lg7EtPahEhldRRc6bZ0RAElURJy6yr7dACaynpCXEno

