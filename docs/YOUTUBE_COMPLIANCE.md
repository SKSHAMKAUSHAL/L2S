# YouTube API Services Compliance & Audit Checklist

This guide is the manual submission checklist for the developer to complete Google OAuth Verification and the YouTube API Services Audit.

---

## 1. Google Cloud Console Configuration

### 1.1 OAuth Consent Screen
- **User Type**: External
- **App Name**: `L2S` (or your registered brand name)
- **User Support Email**: `support@yourdomain.com` (must be a valid inbox)
- **App Logo**: 120x120px PNG with transparent or solid background
- **Application Home Page**: `https://yourdomain.com`
- **Application Privacy Policy Link**: `https://yourdomain.com/privacy`
- **Application Terms of Service Link**: `https://yourdomain.com/terms`
- **Authorized Domains**:
  - `yourdomain.com`
- **Developer Contact Information**: `admin@yourdomain.com`

---

## 2. Scope Justification

### Scopes Requested
1. `https://www.googleapis.com/auth/youtube.upload`
2. `openid`
3. `email`
4. `profile`

### Written Justification for `youtube.upload`
*(Copy-paste this into the Google Cloud Console scope justification box)*:
> "L2S is an AI-powered video editing and repurposing platform. Users upload their long-form video content (or provide videos they own), and L2S creates short-form vertical highlight clips (Shorts).
> 
> The `youtube.upload` scope is requested exclusively to allow authenticated users to publish their generated vertical clips directly to their own connected YouTube channel as YouTube Shorts upon their explicit request. The application never deletes, modifies, or accesses any existing videos on the user's channel. No user tokens or private data are shared or sold. The upload occurs only when the user clicks 'Publish to YouTube'."

---

## 3. Demo Video Requirements & Script

Google requires an unlisted YouTube video showing the exact OAuth grant flow and how the requested scopes are utilized.

### Video Requirements
- Length: 2 to 4 minutes.
- Resolution: 1080p.
- Must show the full browser URL bar clearly showing the client ID.
- Must show the Google OAuth consent screen.
- Must show the app actually performing the action granted by the scope.

### Demo Video Step-by-Step Script
1. **0:00 - 0:30**: Introduction. Show the L2S dashboard. Explain: "This video demonstrates how L2S uses the youtube.upload scope to publish user-generated short clips to their YouTube channel."
2. **0:30 - 1:00**: Connect Channel.
   - Click "Connect YouTube Channel".
   - Show the browser address bar displaying the OAuth authorization URL with `client_id=...` clearly visible.
   - Complete Google login and select the test channel.
   - Show the consent screen displaying the app name and requested permissions.
   - Accept permissions. Redirect back to L2S dashboard showing the connected account.
3. **1:00 - 2:00**: Generate & Publish Clip.
   - Select a processed vertical short clip.
   - Show title, description, and `#Shorts` tag.
   - Click "Publish to YouTube".
   - Show the upload progress indicator.
4. **2:00 - 2:45**: Verification on YouTube Studio.
   - Open YouTube Studio in a new tab for the connected channel.
   - Show the newly uploaded video appearing in the user's Content list under Shorts.
   - Note the privacy status matches the setting.
5. **2:45 - 3:15**: Disconnect.
   - Return to L2S settings.
   - Click "Disconnect YouTube".
   - Show that the token is revoked and removed from the application.

---

## 4. Legal Compliance Requirements (YouTube API Terms of Service)

Per Section III.A of the YouTube Developer Policies:
1. **Terms of Service**: Must state that by using the YouTube publishing feature, users agree to be bound by the **YouTube Terms of Service** ([https://www.youtube.com/t/terms](https://www.youtube.com/t/terms)).
2. **Privacy Policy**: Must disclose that the application uses YouTube API Services and link to the **Google Privacy Policy** ([http://www.google.com/policies/privacy](http://www.google.com/policies/privacy)).
3. **Data Revocation**: Users must have a clear mechanism to revoke access to their YouTube data within the application settings (implemented via `/api/disconnect/youtube` and Google Security Settings: [https://security.google.com/settings/security/permissions](https://security.google.com/settings/security/permissions)).

---

## 5. YouTube API Quota Extension Audit Steps

When ready to exceed the default 10,000 daily quota:
1. Submit the **YouTube API Services Quota Extension Form**:
   [https://support.google.com/youtube/contact/yt_api_form](https://support.google.com/youtube/contact/yt_api_form)
2. Ensure the demo video is uploaded as Unlisted and included in the form.
3. Include links to `https://yourdomain.com/privacy` and `https://yourdomain.com/terms`.
4. State projected daily upload volume (e.g. 100 uploads/day = 160,000 units/day).
5. Pass the YouTube API Services Compliance Audit review.
