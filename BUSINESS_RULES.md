# Harmonic Beacon - Business Rules & Roles Definitions

## 1. Roles

The system is built around three primary user roles, controlled by the `UserRole` enum in the database and synchronized via Zitadel authentication.

### LISTENER (Default)
**Definition**: The standard end-user of the platform. Any user who signs up is a Listener by default.

**Capabilities**:
*   **Consumption**: Can listen to live streams and pre-recorded meditations.
*   **Participation**: Can join scheduled sessions via invites.
*   **Personalization**: Can list "Favorites" and has a history of "Listening Sessions" to track their usage.
*   **Profile**: Has a basic profile with avatar and name.

### PROVIDER
**Definition**: A content creator or guide. This role is granted to users who are vetted or authorized to contribute content to the ecosystem.

**Capabilities**:
*   **All Listener capabilities** (inherits everything above).
*   **Content Creation**: Can upload and manage `Meditations` (audio/video files).
*   **Session Management**: Can create, schedule, and host `ScheduledSessions`.
*   **Broadcasting**: Has permissions to stream content (associated with `stream_name` and `room_name` in the DB).
*   **Analytics**: Access to data about their sessions and recordings (implied by database relations).

### ADMIN
**Definition**: System administrator with oversight capabilities.

**Capabilities**:
*   **Superuser Access**: Can access any session or resource, regardless of ownership (e.g., verified in API routes like `/api/sessions/[id]`).
*   **Moderation**: Likely responsible for approving/rejecting meditations (based on `ModerationStatus` enum: `PENDING`, `APPROVED`, `REJECTED`).
*   **User Management**: although not explicitly seen in the UI code, the backend supports admin overrides.

## 2. Key Concepts & Uses

### Meditations
*   Static content (audio/video) uploaded by Providers.
*   Must go through a **Moderation** process (`isPublished` flag and `ModerationStatus`) before being available to Listeners.
*   Categorized by tags (Mood, Technique, Duration, Language).

### Listening Sessions
*   A record of a user consuming content.
*   Types: `LIVE` (radio/stream), `MEDITATION` (on-demand), or `SCHEDULED_SESSION` (event).
*   Tracks duration and completion status.

### Scheduled Sessions
*   Live, interactive events hosted by a Provider.
*   Can be recorded (`SessionRecording`).
*   Access can be controlled via `SessionInvite`.

### Navigation & UI
*   Currently, the primary navigation (`Live`, `Meditate`, `Sessions`, `Profile`) is consistent for all users, but the backend logic (`isAdminOrProvider`) is in place to gate specific features (like creating sessions) in future updates or specific API endpoints.
