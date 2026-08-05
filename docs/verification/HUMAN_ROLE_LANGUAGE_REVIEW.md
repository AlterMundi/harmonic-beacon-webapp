# Human review — roles, capabilities and ES/EN language

**Acceptance gates:** #66 and #68

Automated tests prove authorization and dictionary coverage. They cannot prove
that a person understands what a role permits, predicts a sensitive action, or
finds Spanish and English fluent. This protocol supplies the missing human
evidence without weakening either issue.

## Review conditions

- Use a synthetic fixture environment tied to an exact Git SHA. Never use a
  production account, ticket, email, participant name or session contribution.
- Recruit at least one fluent Spanish reviewer and one fluent English reviewer.
  Each language needs at least one reviewer who did not implement the UI and is
  not coached on the capability matrix beforehand.
- Prefer reviewers who could realistically participate or operate but are not
  expected to understand LiveKit, entitlements or internal role enums.
- Record an opaque reviewer code, language/proficiency, date, SHA, browser,
  viewport/device class and result. Do not record their name or contact details.
- Run the role interview before explaining correct answers. A prompted or
  coached answer is a failure for comprehension, even if the action later works.
- A defect found here becomes a minimal linked issue; do not silently edit the
  evidence after changing copy.

## Environment record

| Field | Value |
|---|---|
| Git SHA | |
| Environment/URL | |
| Date and timezone | |
| Reviewer code | |
| Review language | ES / EN |
| Proficiency | fluent / native / other |
| Browser and version | |
| Device/viewport class | desktop / mobile / tablet |
| Assigned event fixture | |
| Unassigned event fixture | |

The reviewer must see the exact build named above. If the SHA is not observable,
stop and resolve #124 rather than attributing evidence to an unknown release.

## Part A — unaided role comprehension (#66)

Run each row in the selected language. Present the signed-in identity/help text
and relevant navigation, but do not reveal the expected answer. Ask:

1. “Who are you here?”
2. “What can you do in this event?”
3. “What can you do in a different event?”
4. “Can you publish microphone or camera now?”
5. “What happens if you give someone the floor or enable their media?”
6. “What can you never do remotely to that person?”

Then ask the reviewer to predict the result before trying the marked actions.

| Role | Context | Prediction/actions to review | Safety-critical expected understanding | Result |
|---|---|---|---|---|
| Participant | entitled event | enter, listen, hand, invitation accept/decline | Controls own camera/mic; raising a hand does not publish | |
| Facilitator | assigned event | room, stage, invitations, lifecycle | May facilitate/publish here; invitation still requires participant consent | |
| Facilitator | unassigned event | direct URL and staff navigation | Cannot operate or disclose another event | |
| Facilitator-operator | assigned event | room, stage, admission, health, reconciliation | One real identity; may facilitate and initially publish here | |
| Facilitator-operator | unassigned event | operation and room entry | May operate globally but enters subscribe-only; is not assigned facilitator | |
| Operator | any event | admission, health, reconciliation, stage operation | May operate; does not receive automatic mic/camera publication | |
| Administrator | any event | administration and operation | Broad authority; does not receive automatic publication merely from role | |

For “give the floor”/media controls, the reviewer must state that the action
invites or authorizes and that the participant still chooses whether to activate
their devices. Any expectation that staff can silently unmute a remote camera or
microphone is a safety-critical failure.

### Part A pass rule

- 100% of safety-critical predictions must be correct without coaching.
- The reviewer must distinguish all three concepts: “may operate”, “is assigned
  facilitator”, and “may publish now”.
- The displayed identity must never expose `FACILITATOR_OP` or another raw enum.
- Navigation and disabled/hidden controls must agree with the server result; a
  hidden control alone does not count as authorization evidence.
- Any safety-critical miss keeps #66 open and requires copy/interaction review.

## Part B — fluent ES/EN review (#68)

Run the complete checklist separately in Spanish and English. Start without a
saved preference, then repeat with each locale persisted.

### Locale behavior

- [ ] Event language is the initial default only when no preference exists.
- [ ] Switching locale updates visible copy and `document.lang` together.
- [ ] Preference survives reload, a new tab, login and staff/room transitions.
- [ ] Changing locale never changes the selected event or authority.
- [ ] No primary surface renders both languages simultaneously unless the
      product explicitly calls for bilingual copy.

### Surface walk

- [ ] Public/session list and waiting/closed/live/ended states.
- [ ] Attendee entry, audio activation, room controls, hands and invitations.
- [ ] Staff identity, navigation and role-capability explanation.
- [ ] Conductor lifecycle, hands, stage and reconciliation states.
- [ ] Admission, health and operational support states.
- [ ] Errors for denied, expired, revoked, unavailable and retryable actions.
- [ ] Dates/times show understandable local and event-zone context where needed.
- [ ] Keyboard names, screen-reader labels and status announcements use the same
      language as the visible surface.

### Fluency questions

For each surface, ask the fluent reviewer:

- Is the intended next action obvious without translating mentally?
- Does the copy describe the person's situation rather than internal auth/RTC
  vocabulary?
- Are the same concepts named consistently across navigation, buttons, errors
  and help?
- Is the tone calm, human and precise rather than literal or machine-like?
- Does any truncation, cramped layout or ambiguous abbreviation change meaning?

Record every questionable phrase verbatim with route/surface and a proposed
meaning, not merely “translation feels wrong”. The implementer may choose
different final wording after product review.

### Part B pass rule

- Every checkbox passes in both languages on the exact reviewed SHA.
- No raw enum, internal error, untranslated user-visible string or mixed-locale
  action remains in the scoped surfaces.
- Each fluent reviewer marks every critical action/error as natural and
  unambiguous. Stylistic preferences may be documented separately; ambiguity
  that changes predicted behavior is a failure.
- At least one 320 px/mobile pass confirms that long copy remains complete and
  actionable without horizontal scrolling or meaning-changing truncation.

## Evidence sheet

Duplicate this table for ES and EN. Store it in a dated file under
`docs/verification/` or attach it to #66/#68. Screenshots are optional and must
contain fixture identities only.

| Scenario | Prediction before action | Observed result | Pass/fail | Linked issue/evidence |
|---|---|---|---|---|
| Participant | | | | |
| Facilitator assigned | | | | |
| Facilitator unassigned | | | | |
| Facilitator-operator assigned | | | | |
| Facilitator-operator unassigned | | | | |
| Operator | | | | |
| Administrator | | | | |
| Locale persistence | | | | |
| Attendee critical path | | | | |
| Staff critical path | | | | |
| Errors and terminal states | | | | |
| 320 px/mobile copy | | | | |

Reviewer declaration:

> I reviewed the build identified above without seeing the expected capability
> answers first. The recorded predictions and language findings reflect what I
> understood from the interface itself.

## Closing the issues

#66 may close only when Part A passes in ES and EN and its evidence links the
exact SHA. #68 may close only when Part B passes in both languages. One review
can cover both parts, but automated tests, an implementer's self-review or a
review against an unknown production revision cannot substitute for these
human gates.
