# Roadmap: Notify users when uploads finish

Plan: notify-on-upload-finish.html

Six packages, data first and UI last. Tests ship with their code, so the build stays green after each one.

## Packages

### wp-1: Schema
Status: open
- Goal: notifications table and typed model; migration runs up and down
- Covers: #step-1
- Start from: `db/migrations/`, newest migration as pattern
- Done when: `pnpm db:migrate`, `pnpm test db` pass
- Not here: service functions (wp-2)

### wp-2: Service
Status: open
- Goal: create, list, and mark read, with unit tests
- Covers: #step-2
- Needs: wp-1
- Start from: `src/uploads/service.ts` as pattern
- Done when: `pnpm test notifications` passes
- Not here: HTTP routes (wp-4)

### wp-3: Consumer
Status: open
- Goal: processed and failed uploads create one notification each
- Covers: #step-3, #check-3
- Needs: wp-2
- Start from: `src/workers/`, an existing queue consumer
- Done when: consumer test shows idempotency on `upload_id`
- Not here: mail job (wp-6)

### wp-4: API
Status: open
- Goal: authenticated list and mark-read routes over the service
- Covers: #step-4
- Needs: wp-2
- Start from: `src/api/`, session middleware
- Done when: route tests pass; unauthenticated gets 401

### wp-5: Bell
Status: open
- Goal: top bar bell with unread count, live over the user channel
- Covers: #step-5, #check-1
- Needs: wp-4
- Start from: `src/components/TopBar.tsx`, websocket hook
- Done when: component test; count updates within 5 s in the dev app
- Not here: settings toggle (wp-6)

### wp-6: Email
Status: open
- Goal: opted-in users get exactly one mail per upload
- Covers: #step-6, #step-7, #check-2
- Needs: wp-3
- Start from: `src/settings/profile.tsx`, `src/mail/`
- Done when: mail catcher test, one mail with the toggle on, none off

## Run
- Checks: `pnpm typecheck`, `pnpm test`
- Scout: Planner
- Builder: Builder

## Risks
- wp-3 and wp-6 both touch the consumer → wp-6 only adds the mail enqueue
