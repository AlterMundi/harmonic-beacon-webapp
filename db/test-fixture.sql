--
-- PostgreSQL database dump
--

\restrict HfdulNi6iRYG5ik2xVFyvsLq0gcjrmkMXLcwxegYIXQrNAKlUnSnbrCpXni7pix

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
    'FACILITATOR_OP',
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
    actor_role public."StaffRole",
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
810f3d42-95c1-4935-b9bf-46c2606c5ece	0ebfb48f939f53716f741c62751c82fcfe2f57c461896dc7127ce6ecf8b8eb0b	2026-07-31 03:40:40.34573+00	20260728120000_weekend_mvp	\N	\N	2026-07-31 03:40:40.226566+00	1
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, actor_user_id, actor_role, action, target_type, target_id, reason, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: scheduled_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheduled_sessions (id, title, description, room_name, language, scheduled_at, started_at, ended_at, status, paid_mode, attendee_cap, max_publishers, facilitator_id, created_at, updated_at) FROM stdin;
10000000-0000-4000-8000-000000000101	Harmonic Projection — Sesión en Español (test)	Test fixture session. Spanish, Saturday 2026-08-01 08:30 Costa Rica.	weekend-test-spanish	SPANISH	2026-08-01 14:30:00	\N	\N	SCHEDULED	t	150	6	f9f85a6c-4a8a-4e01-bb21-29aa82f58e2b	2026-07-31 03:40:41.592	2026-07-31 03:40:41.592
10000000-0000-4000-8000-000000000102	Harmonic Projection — English Session (test)	Test fixture session. English, Saturday 2026-08-01 12:30 Costa Rica.	weekend-test-english	ENGLISH	2026-08-01 18:30:00	\N	\N	SCHEDULED	t	150	6	f9f85a6c-4a8a-4e01-bb21-29aa82f58e2b	2026-07-31 03:40:41.637	2026-07-31 03:40:41.637
\.


--
-- Data for Name: session_participants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.session_participants (id, scheduled_session_id, participant_identity, ticket_entitlement_id, staff_user_id, joined_at, left_at, raised_at, publish_granted_at, publish_revoked_at, grant_version, grant_reconcile_needed, grant_changed_by_user_id, grant_reason, created_at, updated_at) FROM stdin;
1cd04490-b460-473f-b21c-acb7256e8b24	10000000-0000-4000-8000-000000000101	test-facilitator-identity	\N	f9f85a6c-4a8a-4e01-bb21-29aa82f58e2b	2026-07-31 03:40:41.603	\N	\N	2026-07-31 03:40:41.602	\N	0	f	f9f85a6c-4a8a-4e01-bb21-29aa82f58e2b	Test fixture facilitator baseline grant	2026-07-31 03:40:41.603	2026-07-31 03:40:41.603
096b14aa-b3f3-4a01-8f11-2fcf767a6d0d	10000000-0000-4000-8000-000000000102	test-facilitator-identity	\N	f9f85a6c-4a8a-4e01-bb21-29aa82f58e2b	2026-07-31 03:40:41.643	\N	\N	2026-07-31 03:40:41.641	\N	0	f	f9f85a6c-4a8a-4e01-bb21-29aa82f58e2b	Test fixture facilitator baseline grant	2026-07-31 03:40:41.643	2026-07-31 03:40:41.643
\.


--
-- Data for Name: ticket_entitlements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ticket_entitlements (id, scheduled_session_id, code_digest, code_last_four, tier, state, bound_email, bound_at, expires_at, issued_by_user_id, revoked_at, revoked_by_user_id, revocation_reason, created_at, updated_at) FROM stdin;
a3c934cc-a8f4-4029-b464-97063ac9feaa	10000000-0000-4000-8000-000000000101	42acb76fe9a22737b31c801165e1e001324014b852f26f36951fc89020561ef5	TESA	GLOBAL_SOUTH	ISSUED	\N	\N	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.611	2026-07-31 03:40:41.611
909cc003-a292-43f6-b019-44e1055fc397	10000000-0000-4000-8000-000000000101	8e7dcbc67f348b16a031d2da0cde54d74e10f299b909246480e280bf3bd94b26	TESB	GLOBAL_SOUTH	ISSUED	\N	\N	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.616	2026-07-31 03:40:41.616
776ff3f5-a287-4897-a475-eb2d53b12295	10000000-0000-4000-8000-000000000101	1d6a5c3e2afddfe17462ba0a03c704fd0062392f8970d6d9b5306a179ab98077	TESC	GLOBAL_SOUTH	ISSUED	\N	\N	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.62	2026-07-31 03:40:41.62
3b8e07ff-7ec7-4c6d-a6f6-5d3e7c78ac21	10000000-0000-4000-8000-000000000101	54475508d917139bdbea92a6d747b2add65320daa7b61cac7fe98f14eaf759e4	TESD	GLOBAL_SOUTH	BOUND	asistente@altermundi.net	2026-07-31 03:40:41.623	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.624	2026-07-31 03:40:41.624
ddc7e0c4-b994-4115-9300-2fe260489996	10000000-0000-4000-8000-000000000101	21844178b5e420716cfc16ebd2a1755e3fbdd1048c954864846a38c17e9960ae	TESE	GLOBAL_SOUTH	REVOKED	\N	\N	2026-08-02 14:30:00	\N	2026-07-31 03:40:41.627	\N	Test fixture revoked ticket	2026-07-31 03:40:41.628	2026-07-31 03:40:41.628
ddd5352b-afbe-497b-844c-c4a64621368b	10000000-0000-4000-8000-000000000101	b893360dd78d460d6888db315cde27ae17be97327180166d09f8931886ce1233	TESF	COMP	ISSUED	\N	\N	2026-08-02 14:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.633	2026-07-31 03:40:41.633
18f1f00f-54cc-4b1d-ba23-56421d75c113	10000000-0000-4000-8000-000000000102	a4b3377372c07f8208c70182309db5a38f61691db6fe2dda457cade98d7c079a	TENA	GLOBAL_NORTH	ISSUED	\N	\N	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.647	2026-07-31 03:40:41.647
d565e399-71ee-43d5-81c6-ebb4e8f2a73d	10000000-0000-4000-8000-000000000102	b240dec0a42847992ec18d5b2eb2a29570c37242d50b8f64df168e13da5db9bc	TENB	GLOBAL_NORTH	ISSUED	\N	\N	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.651	2026-07-31 03:40:41.651
98ac9525-4b58-4e42-8d94-2e045c5ce66d	10000000-0000-4000-8000-000000000102	5b3a70d2074b8a6f19a421ae972a5ecace18cd293605ec0df881f4f2d296d66d	TENC	GLOBAL_NORTH	ISSUED	\N	\N	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.654	2026-07-31 03:40:41.654
4a68238d-03df-4ecb-9212-ceb67bf62f6b	10000000-0000-4000-8000-000000000102	6c4d3ec6f95a81a261b1eaf0ef1acde2e3ff93efb2af9dd0eb4eba735c64129d	TEND	GLOBAL_NORTH	BOUND	attendee@altermundi.net	2026-07-31 03:40:41.656	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.657	2026-07-31 03:40:41.657
2ed0329d-0ad4-455a-8296-40c3d520a5e6	10000000-0000-4000-8000-000000000102	f2389146861c730028f748af029ec30d5e9f80e76c90fe947eb3b0a2d5dcaba7	TENE	GLOBAL_NORTH	REVOKED	\N	\N	2026-08-02 18:30:00	\N	2026-07-31 03:40:41.66	\N	Test fixture revoked ticket	2026-07-31 03:40:41.661	2026-07-31 03:40:41.661
05413703-182d-423a-9a42-320f910d2355	10000000-0000-4000-8000-000000000102	8816356813cb30cf247d1185981482ee69046203f587d672bb9deece1785be61	TENF	COMP	ISSUED	\N	\N	2026-08-02 18:30:00	\N	\N	\N	\N	2026-07-31 03:40:41.664	2026-07-31 03:40:41.664
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, name, role, password_digest, disabled_at, created_at, updated_at) FROM stdin;
f9f85a6c-4a8a-4e01-bb21-29aa82f58e2b	facilitator@altermundi.net	Test Facilitator	FACILITATOR	scrypt$Zml4dHVyZS1zYWx0LWZhYzAx$YB4mTzvK9c6bopNNFRVz2TVvtVAElu6v58-geir3Vvc	\N	2026-07-31 03:40:41.41	2026-07-31 03:40:41.41
9a05dae0-c2ed-4fb5-9055-038148771a3d	operator1@altermundi.net	Test Operator One	OPERATOR	scrypt$Zml4dHVyZS1zYWx0LW9wMDAx$Zf4xXnLOsV-mF3HANjmOmh7K9viVI5NgpbnmMYf6TO8	\N	2026-07-31 03:40:41.471	2026-07-31 03:40:41.471
66eab636-c5b6-4371-8578-c7807d7c266e	operator2@altermundi.net	Test Operator Two	OPERATOR	scrypt$Zml4dHVyZS1zYWx0LW9wMDAy$ua1yfWxwDYrpb3t8_9LJlzlhNWLIisM4mJy-AQ5WOdI	\N	2026-07-31 03:40:41.525	2026-07-31 03:40:41.525
58792573-09fa-46a5-8eba-166fa4bd45af	admin@altermundi.net	Test Admin	ADMIN	scrypt$Zml4dHVyZS1zYWx0LWFkbTAx$kSd1m-XyTYTZvI1N_z7XOmmlc8-gVXf7ulIzRcIohvg	\N	2026-07-31 03:40:41.578	2026-07-31 03:40:41.578
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

\unrestrict HfdulNi6iRYG5ik2xVFyvsLq0gcjrmkMXLcwxegYIXQrNAKlUnSnbrCpXni7pix
