# Werox Mini Program Plan

## Goal
Deliver a Hyrox event mini program with a strong “运动科技感” UI, supporting user profiles, event management, and coach-adjusted training scores.

## Scope (Current Phase)
- **Pages**: Events, Event Detail, Profile, Profile Edit, Attendance Edit, Admin Event Publish
- **Roles**: user / coach / admin
- **Core Features**:
  - View upcoming events
  - Profile display with tags, stats, and attendance records
  - Floating “编辑主页” entry for self-edit
  - Coach/admin can add/adjust attendance scores
  - Admin can publish events

## Data Model (CloudBase NoSQL)
- **users**
  - nickname (string)
  - age (number)
  - heartRate (number)
  - bio (string)
  - avatarFileId (string)
  - wechatId (string, manual input)
  - tags (array)
  - role (user | coach | admin)
  - createdAt (number)
  - updatedAt (number)
- **events**
  - title (string)
  - date (string, YYYY-MM-DD)
  - location (string)
  - host (string)
  - coverUrl (string)
  - description (string)
  - statusText (string)
  - baseStrength (number)
  - baseEndurance (number)
  - createdAt (number)
- **event_attendance**
  - eventName (string)
  - gymName (string)
  - baseStrength (number)
  - baseEndurance (number)
  - coachAdjustStrength (number)
  - coachAdjustEndurance (number)
  - finalStrength (number)
  - finalEndurance (number)
  - createdAt (number)

## Architecture
- **Mini Program UI**: `pages/events`, `pages/event-detail`, `pages/profile`, `pages/profile-edit`, `pages/admin-events`
- **Cloud Function**: `getOpenId` (user identity)
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
