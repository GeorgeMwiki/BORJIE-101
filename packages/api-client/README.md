# @borjie/api-client

Typed HTTP client SDK wrapping the API gateway. Frontends import this instead of fetching directly so request/response shapes stay in sync with the OpenAPI spec.

## Usage

```ts
import { createApiClient } from '@borjie/api-client'

const api = createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL!, getToken })
const properties = await api.properties.list({ page: 1, limit: 20 })
```
