# Werox Mini Program Plan

## Goal
Deliver a Hyrox event mini program with a strong "运动科技感" UI, supporting user profiles, event management, and coach-adjusted training scores.

## Scope (Current Phase)
- **Pages**: Events, Event Detail, Profile, Event Signup, Admin Events
- **Roles**: user / coach / admin
- **Core Features**:
  - View upcoming events
  - Profile display with tags, stats, and attendance records (inline editing)
  - Floating "编辑主页" entry for self-edit
  - Coach/admin can add/adjust attendance scores
  - Admin can publish events with slug for deduplication

## Data Model (CloudBase NoSQL)
- **users**
  - _openid (string, auto-set by CloudBase)
  - nickname (string)
  - age (number)
  - heartRate (number)
  - bio (string)
  - avatarFileId (string)
  - wechatId (string, manual input)
  - tags (array)
  - sex (string)
  - trainingFocus (string)
  - hyroxExperience (string)
  - partnerRole (string)
  - partnerNote (string)
  - mbti (string)
  - role (user | coach | admin)
  - createdAt (number)
  - updatedAt (number)
- **events**
  - title (string)
  - slug (string, unique identifier for deduplication)
  - date (string, YYYY-MM-DD)
  - location (string)
  - host (string)
  - coverUrl (string)
  - posterUrl (string)
  - description (string)
  - statusText (string)
  - baseStrength (number)
  - baseEndurance (number)
  - maxParticipants (number, optional)
  - price (number)
  - createdAt (number)
  - updatedAt (number)
- **event_participants** (single source of truth for signup + attendance records)
  - _openid (string, user identifier)
  - eventId (string, reference to events collection)
  - eventTitle (string)
  - eventDate (string)
  - eventLocation (string)
  - price (number)
  - maxParticipants (number, optional)
  - profileSnapshot (object, user profile at signup time)
  - eventForm (object: groupType, partnerName, note)
  - baseStrength (number, from event)
  - baseEndurance (number, from event)
  - coachAdjustStrength (number, coach adjustment)
  - coachAdjustEndurance (number, coach adjustment)
  - finalStrength (number, computed)
  - finalEndurance (number, computed)
  - createdAt (number)

## Architecture
- **Mini Program UI**: `pages/events`, `pages/event-detail`, `pages/profile`, `pages/event-signup`, `pages/admin-events`
- **Cloud Function**: `getOpenId` (user identity), `importEventsStub`, `importUsersStub`, `exportEventParticipants`
- **Role Resolution**: `utils/roles.js` (openid allowlist)

## Tasks
1. **UI & Theme**
   - Apply black-gold industrial sports visual style
   - Normalize card layout and stats presentation
2. **Profile System**
   - Display tags, wechatId, bio, stats, attendance list
   - Floating edit button for self-edit
3. **Score Adjustment**
   - Coach/admin edit attendance records
   - Auto compute finalStrength/finalEndurance
4. **Admin Event Publishing**
   - Admin-only event creation form
   - Events page loads DB data (fallback to stub)

## Future Enhancements
- Coach/admin list to manage multiple athletes
- Event photo album & community feed
- Performance analytics dashboard
- Map-based event discovery
