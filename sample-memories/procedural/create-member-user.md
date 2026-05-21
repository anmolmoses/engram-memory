---
name: create-member-user
description: How to create a member user and grant admin dashboard access
importance: 6
metadata:
  type: procedural
---
Steps to create a new member user and (optionally) grant admin dashboard access:

1. Confirm the person's full email and phone number. Phone must be the complete number including country/area code — a short number means the lookup will silently miss.
2. Look the person up first by email, then by phone, then by name to avoid creating a duplicate account.
3. If no existing document is found, create the member user record with their verified contact details.
4. To grant admin dashboard access, set the admin role flag on the user after the member record exists. Verify the role actually persisted by re-reading the user.
