targetScope = 'resourceGroup'

param location string

@allowed(['dev', 'staging', 'prod'])
param environment string

param prefix string
param acrName string
param orchestratorImageTag string
param runtimeImageTag string
param adminImageTag string

// Redis connection details
param redisHostName string
param redisPort int
// Redis primary key passed from the redis module output (resolved in main.bicep)
@secure()
param redisPrimaryKey string

// PostgreSQL
param postgresServerFqdn string
param postgresDatabaseName string
param postgresAdminLogin string

// Key Vault
param keyVaultUri string

// Managed Identity (created in keyvault module)
param managedIdentityId string
param managedIdentityClientId string
param managedIdentityPrincipalId string

// ---------------------------------------------------------------------------
// Log Analytics Workspace
// ---------------------------------------------------------------------------
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---------------------------------------------------------------------------
// Container Registry
// ---------------------------------------------------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: {
    name: environment == 'prod' ? 'Standard' : 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// AcrPull role for managed identity — use managedIdentityPrincipalId directly
resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // AcrPull — 7f951dda-4ed3-4680-a7ca-43fe172d538d
  name: guid(acr.id, managedIdentityId, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// ACA Managed Environment
// ---------------------------------------------------------------------------
resource acaEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-aca-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Common environment variables shared by all apps
// Bicep uses [...arr1, ...arr2] spread syntax (not concat())
// ---------------------------------------------------------------------------
var commonEnv = [
  {
    name: 'NODE_ENV'
    value: environment
  }
  {
    name: 'REDIS_HOST'
    value: redisHostName
  }
  {
    name: 'REDIS_PORT'
    value: string(redisPort)
  }
  {
    name: 'MANAGED_IDENTITY_CLIENT_ID'
    value: managedIdentityClientId
  }
  {
    name: 'DATABASE_URL'
    value: 'postgresql://${postgresAdminLogin}@${postgresServerFqdn}/${postgresDatabaseName}?sslmode=require'
  }
]

// ---------------------------------------------------------------------------
// Orchestrator App
// ---------------------------------------------------------------------------
resource orchestratorApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-orchestrator'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: acaEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentityId
        }
      ]
      secrets: [
        {
          name: 'api-key'
          keyVaultUrl: '${keyVaultUri}secrets/API-KEY'
          identity: managedIdentityId
        }
        {
          name: 'redis-password'
          value: redisPrimaryKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'orchestrator'
          image: '${acr.properties.loginServer}/orchestrator:${orchestratorImageTag}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            ...commonEnv
            {
              name: 'API_KEY'
              secretRef: 'api-key'
            }
            {
              name: 'REDIS_PASSWORD'
              secretRef: 'redis-password'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'SOPS_DIR'
              value: '/app/sops'
            }
            {
              name: 'CONFIG_PATH'
              value: '/app/config/config.yaml'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime Worker App (KEDA-scaled on Redis list/stream queue length)
// ---------------------------------------------------------------------------
resource runtimeApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-runtime'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: acaEnvironment.id
    configuration: {
      // No external ingress — this is a background worker
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentityId
        }
      ]
      secrets: [
        {
          name: 'anthropic-api-key'
          keyVaultUrl: '${keyVaultUri}secrets/ANTHROPIC-API-KEY'
          identity: managedIdentityId
        }
        {
          name: 'redis-connection-string'
          // rediss:// scheme for TLS — password embedded for KEDA scaler
          value: 'rediss://:${redisPrimaryKey}@${redisHostName}:${string(redisPort)}'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'runtime'
          image: '${acr.properties.loginServer}/runtime:${runtimeImageTag}'
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            ...commonEnv
            {
              name: 'ANTHROPIC_API_KEY'
              secretRef: 'anthropic-api-key'
            }
            {
              name: 'REDIS_PASSWORD'
              secretRef: 'redis-connection-string'
            }
            {
              name: 'PROMPTS_DIR'
              value: '/app/prompts'
            }
            {
              name: 'SOPS_DIR'
              value: '/app/sops'
            }
            {
              name: 'CONFIG_PATH'
              value: '/app/config/config.yaml'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 10
        rules: [
          {
            name: 'bullmq-queue-length'
            custom: {
              // KEDA redis-lists scaler — matches BullMQ's internal list-based queue
              type: 'redis-lists'
              metadata: {
                listName: 'bull:jobs:wait'
                listLength: '5'
                address: '${redisHostName}:${string(redisPort)}'
                enableTLS: 'true'
              }
              auth: [
                {
                  secretRef: 'redis-connection-string'
                  triggerParameter: 'password'
                }
              ]
            }
          }
        ]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Admin App
// ---------------------------------------------------------------------------
resource adminApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-admin'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: acaEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3001
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: managedIdentityId
        }
      ]
      secrets: [
        {
          name: 'api-key'
          keyVaultUrl: '${keyVaultUri}secrets/API-KEY'
          identity: managedIdentityId
        }
        {
          name: 'redis-password'
          value: redisPrimaryKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'admin'
          image: '${acr.properties.loginServer}/admin:${adminImageTag}'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            ...commonEnv
            {
              name: 'API_KEY'
              secretRef: 'api-key'
            }
            {
              name: 'REDIS_PASSWORD'
              secretRef: 'redis-password'
            }
            {
              name: 'PORT'
              value: '3001'
            }
            {
              name: 'SOPS_DIR'
              value: '/app/sops'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/admin/runs'
                port: 3001
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output orchestratorUrl string = 'https://${orchestratorApp.properties.configuration.ingress.fqdn}'
output adminUrl        string = 'https://${adminApp.properties.configuration.ingress.fqdn}'
output acrLoginServer  string = acr.properties.loginServer
output acaEnvironmentId string = acaEnvironment.id
