targetScope = 'resourceGroup'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@description('Environment name')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'dev'

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Tenant / company identifier (e.g. acme-software). Used as a resource name prefix.')
param tenantId string

@description('Container Registry name — must be globally unique, 5-50 lowercase alphanumeric characters')
param acrName string

@description('Orchestrator container image tag')
param orchestratorImageTag string = 'latest'

@description('Runtime worker container image tag')
param runtimeImageTag string = 'latest'

@description('Admin UI container image tag')
param adminImageTag string = 'latest'

@description('API key for orchestrator and admin HTTP endpoints')
@secure()
param apiKey string

@description('Anthropic API key used by the runtime worker')
@secure()
param anthropicApiKey string

@description('PostgreSQL administrator password. If omitted a random GUID is used (suitable for dev).')
@secure()
param postgresAdminPassword string = newGuid()

// ---------------------------------------------------------------------------
// Shared naming prefix
// ---------------------------------------------------------------------------
var prefix = '${tenantId}-${environment}'

// ---------------------------------------------------------------------------
// 1. Key Vault + Managed Identity
//    Secrets are passed as an array of { name, value } objects to avoid
//    relying on objectKeys() which is not available in all Bicep versions.
// ---------------------------------------------------------------------------
module keyvault './keyvault.bicep' = {
  name: 'deploy-keyvault'
  params: {
    location: location
    keyVaultName: '${prefix}-kv'
    environment: environment
    secrets: [
      {
        name: 'API-KEY'
        value: apiKey
      }
      {
        name: 'ANTHROPIC-API-KEY'
        value: anthropicApiKey
      }
      {
        name: 'POSTGRES-ADMIN-PASSWORD'
        value: postgresAdminPassword
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// 2. Azure Cache for Redis
// ---------------------------------------------------------------------------
module redis './redis.bicep' = {
  name: 'deploy-redis'
  params: {
    location: location
    redisCacheName: '${prefix}-redis'
    environment: environment
  }
}

// ---------------------------------------------------------------------------
// 3. PostgreSQL Flexible Server
// ---------------------------------------------------------------------------
module postgres './postgres.bicep' = {
  name: 'deploy-postgres'
  params: {
    location: location
    serverName: '${prefix}-pg'
    environment: environment
    adminLogin: 'pgadmin'
    adminPassword: postgresAdminPassword
    databaseName: 'orchestrator'
  }
}

// ---------------------------------------------------------------------------
// 4. Container Apps Environment + Apps
//    The Redis primary key is retrieved here via listKeys() so it can be
//    passed as a secure parameter — avoids using listKeys() inside a loop
//    or variable that may not be evaluated lazily.
// ---------------------------------------------------------------------------
module aca './aca.bicep' = {
  name: 'deploy-aca'
  params: {
    location: location
    environment: environment
    prefix: prefix
    acrName: acrName
    orchestratorImageTag: orchestratorImageTag
    runtimeImageTag: runtimeImageTag
    adminImageTag: adminImageTag

    // Redis
    redisHostName: redis.outputs.hostName
    redisPort: redis.outputs.sslPort
    redisPrimaryKey: listKeys(
      resourceId('Microsoft.Cache/redis', '${prefix}-redis'),
      '2024-03-01'
    ).primaryKey
    redisConnectionString: 'rediss://:${listKeys(resourceId('Microsoft.Cache/redis', '${prefix}-redis'), '2024-03-01').primaryKey}@${redis.outputs.hostName}:${string(redis.outputs.sslPort)}'

    // PostgreSQL
    postgresServerFqdn: postgres.outputs.serverFqdn
    postgresDatabaseName: postgres.outputs.databaseName
    postgresAdminLogin: 'pgadmin'

    // Key Vault + Managed Identity
    keyVaultUri: keyvault.outputs.keyVaultUri
    managedIdentityId: keyvault.outputs.managedIdentityId
    managedIdentityClientId: keyvault.outputs.managedIdentityClientId
    managedIdentityPrincipalId: keyvault.outputs.managedIdentityPrincipalId
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output orchestratorUrl   string = aca.outputs.orchestratorUrl
output adminUrl          string = aca.outputs.adminUrl
output keyVaultUri       string = keyvault.outputs.keyVaultUri
output postgresServerFqdn string = postgres.outputs.serverFqdn
output acrLoginServer    string = aca.outputs.acrLoginServer
output acaEnvironmentId  string = aca.outputs.acaEnvironmentId
