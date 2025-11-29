- [x] Update storage.js to include pixPhoto property in bot state
- [x] Add /pix_foto command in index.js to prompt admin for photo and save it
- [x] Modify payment confirmation flow in index.js to send photo with PIX text if set
- [x] Test the /pix_foto command
- [x] Verify photo is sent with PIX payments

## Referral System Implementation - APPROVED

### Information Gathered
- Current bot state includes users, payments, promotions, and pixPhoto
- Need to add referral tracking: user points, referred users, referral codes
- Referral flow: generate link -> track referrals -> award points on payment confirmation -> redeem points for plans

### Implementation Steps
1. [x] **Update storage.js** - Add referral data structure and functions
2. [ ] **Add referral commands** - /referral (generate link), /pontos (check points), /resgatar (redeem points)
3. [ ] **Modify start handler** - Check for referral codes in start command
4. [ ] **Update payment confirmation** - Award points to referrers when payments are confirmed
5. [ ] **Add point redemption logic** - Allow purchasing plans with points (50 points = 1 plan)

### Dependent Files to be edited
- src/storage.js (add referral functions and state)
- src/index.js (add commands, modify handlers)

### Followup steps
- [ ] Test referral link generation
- [ ] Test point awarding on payment
- [ ] Test point redemption
- [ ] Verify referral tracking accuracy
