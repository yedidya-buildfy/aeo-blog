# Troubleshooting: SEO Blog Feature & Token Management

## 🚨 **CRITICAL ISSUE FOUND**

**Problem**: App has insufficient scopes for blog creation
**Current scopes**: `write_themes,read_themes`
**Required scopes**: `write_content` OR `write_online_store_pages`

---

## 1. **Navigation & Routing Issues**

### Problem: "Improve My SEO" Page Not Visible
**Possible Causes:**
- ✅ Route file exists: `app.seo-blogs.tsx`
- ✅ Navigation link added to `app.tsx`
- ❌ **Missing required scopes** (MAIN ISSUE)

**Solutions:**
```bash
# Fix scopes in shopify.app.toml
scopes = "write_themes,read_themes,write_content"

# Then restart dev server
shopify app dev --reset
```

---

## 2. **Access Scopes & Permissions**

### Current Configuration
```toml
[access_scopes]
scopes = "write_themes,read_themes"
```

### Required for Blog Operations
| Operation | Required Scope | Current Status |
|-----------|---------------|----------------|
| `blogCreate` | `write_content` OR `write_online_store_pages` | ❌ Missing |
| `articleCreate` | `write_content` OR `write_online_store_pages` | ❌ Missing |
| Keyword analysis | None (external API) | ✅ OK |

### Fix Required Scopes
```toml
[access_scopes]
scopes = "write_themes,read_themes,write_content"
```

---

## 3. **Token Management Issues**

### Delegate Access Token Problems
Based on [delegateAccessTokenCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/delegateAccessTokenCreate):

**Potential Issues:**
- **Insufficient delegateAccessScope**: Token creation fails if requested scopes exceed app permissions
- **Token Expiration**: Default expiry might be too short for blog operations
- **Scope Mismatch**: Requesting blog scopes when app only has theme scopes

**Solutions:**
```graphql
mutation createDelegateToken($input: DelegateAccessTokenCreateInput!) {
  delegateAccessTokenCreate(input: $input) {
    delegateAccessToken
    userErrors {
      field
      message
    }
  }
}
```

**Variables:**
```json
{
  "input": {
    "delegateAccessScope": ["write_content"],
    "expiresIn": 3600
  }
}
```

---

## 4. **Authentication Flow Issues**

### Session Management
- **Problem**: Admin context might lose permissions during blog operations
- **Solution**: Ensure `authenticate.admin(request)` is called in each action

### GraphQL Authentication
```typescript
// Correct pattern
const { admin } = await authenticate.admin(request);
const response = await admin.graphql(mutation, { variables });
```

---

## 5. **API-Specific Issues**

### Blog Creation (`blogCreate`)
**Common Errors:**
- `ACCESS_DENIED`: Missing `write_content` scope ❌
- `INVALID_INPUT`: Malformed blog data
- `DUPLICATE_HANDLE`: Blog handle already exists

**Debug Query:**
```graphql
query checkExistingBlogs {
  blogs(first: 5) {
    edges {
      node {
        id
        handle
        title
      }
    }
  }
}
```

### Article Creation (`articleCreate`)
**Common Errors:**
- `BLOG_NOT_FOUND`: Invalid blogId
- `ACCESS_DENIED`: Missing content write permissions ❌
- `INVALID_HTML`: Malformed content HTML

---

## 6. **Gemini API Integration**

### API Key Issues
**Check Environment Variables:**
```bash
# In .env file
GEMINI_API_KEY=your_key_here
```

**Validation:**
```typescript
if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY required');
}
```

### Rate Limiting
- **Problem**: Too many requests to Gemini API
- **Solution**: Implement request queuing/throttling

---

## 7. **Development Environment**

### Server Issues
```bash
# Check if server is running
shopify app dev

# If problems, reset:
shopify app dev --reset

# Check ports
lsof -i :64952
```

### Database Connectivity
```bash
# Test Prisma connection
npx prisma studio

# Check migrations
npx prisma migrate status
```

---

## 8. **Production Deployment Issues**

### App Store Submission
**Required for blog features:**
- App must request `write_content` in store review
- Justify why blog creation is needed
- Provide clear user benefit explanation

### Partner Dashboard Configuration
1. Update app scopes in Partner Dashboard
2. Resubmit for review if scopes changed
3. Test in development store first

---

## 9. **User Experience Issues**

### Loading States
- **Problem**: No feedback during blog creation
- **Solution**: Implement proper loading states ✅ Done

### Error Handling
- **Problem**: Generic error messages
- **Solution**: Parse GraphQL userErrors for specific feedback

```typescript
if (data.data?.articleCreate?.userErrors?.length > 0) {
  const error = data.data.articleCreate.userErrors[0];
  throw new Error(`${error.field}: ${error.message}`);
}
```

---

## 🔧 **IMMEDIATE FIX REQUIRED**

### Step 1: Update Scopes
```toml
# In shopify.app.toml
[access_scopes]
scopes = "write_themes,read_themes,write_content"
```

### Step 2: Restart Development
```bash
# Stop current server (Ctrl+C)
shopify app dev --reset
```

### Step 3: Test Blog Creation
1. Navigate to "Improve My SEO"
2. Find Keywords → Select Keyword → Create Blog
3. Check for permission errors

---

## 🚀 **Testing Checklist**

- [ ] App starts without errors
- [ ] Navigation shows "Improve My SEO" link
- [ ] Page loads successfully
- [ ] Keywords generate from Gemini
- [ ] Keyword selection works
- [ ] Blog creation succeeds (requires scope fix)
- [ ] Success message appears
- [ ] Blog appears in Shopify admin

---

## 📚 **Reference Links**

- [Shopify Access Scopes](https://shopify.dev/docs/api/usage/access-scopes)
- [Blog API Documentation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/blogCreate)
- [Article API Documentation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate)
- [Delegate Access Tokens](https://shopify.dev/docs/api/admin-graphql/latest/mutations/delegateAccessTokenCreate)
- [App Authentication](https://shopify.dev/docs/apps/auth)

---

**Last Updated**: 2025-09-15
**Status**: ✅ **FIXED** - Scopes updated, OAuth flow required on next app visit

## ✅ **ISSUE RESOLVED**

**Fixed**: Added `write_content` scope to `shopify.app.toml`
**Next Step**: Navigate to your app - Shopify will prompt for new OAuth permissions
**Expected**: You'll see "Improve My SEO" page and can create blogs successfully