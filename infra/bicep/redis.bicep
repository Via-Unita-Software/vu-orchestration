targetScope = 'resourceGroup'

param location string
param redisCacheName string

@allowed(['dev', 'staging', 'prod'])
param environment string

// ---------------------------------------------------------------------------
// SKU selection: Basic C0 for dev/staging, Standard C1 for prod
// ---------------------------------------------------------------------------
var skuName     = environment == 'prod' ? 'Standard' : 'Basic'
var skuFamily   = 'C'
var skuCapacity = environment == 'prod' ? 1 : 0

// ---------------------------------------------------------------------------
// Azure Cache for Redis
// ---------------------------------------------------------------------------
resource redisCache 'Microsoft.Cache/redis@2024-03-01' = {
  name: redisCacheName
  location: location
  properties: {
    sku: {
      name: skuName
      family: skuFamily
      capacity: skuCapacity
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    redisConfiguration: {
      'maxmemory-policy': 'allkeys-lru'
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output hostName  string = redisCache.properties.hostName
output sslPort   int    = redisCache.properties.sslPort
output resourceId string = redisCache.id
output redisCacheName string = redisCache.name
