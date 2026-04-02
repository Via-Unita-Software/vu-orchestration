targetScope = 'resourceGroup'

param location string
param serverName string

@allowed(['dev', 'staging', 'prod'])
param environment string

param adminLogin string

@secure()
param adminPassword string

param databaseName string = 'orchestrator'

// ---------------------------------------------------------------------------
// SKU / storage configuration per environment
// ---------------------------------------------------------------------------
var skuName        = environment == 'prod' ? 'Standard_D2ds_v4' : 'Standard_B1ms'
var skuTier        = environment == 'prod' ? 'GeneralPurpose'    : 'Burstable'
var storageSizeGB  = environment == 'prod' ? 128                 : 32

// ---------------------------------------------------------------------------
// PostgreSQL Flexible Server
// ---------------------------------------------------------------------------
resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    version: '16'
    storage: {
      storageSizeGB: storageSizeGB
    }
    backup: {
      backupRetentionDays: environment == 'prod' ? 35 : 7
      geoRedundantBackup: environment == 'prod' ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: environment == 'prod' ? 'ZoneRedundant' : 'Disabled'
    }
  }
}

// ---------------------------------------------------------------------------
// Firewall rule — allow all Azure-internal traffic (0.0.0.0 → 0.0.0.0)
// ---------------------------------------------------------------------------
resource firewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgresServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ---------------------------------------------------------------------------
// Server configuration — enable the pgvector extension
// ---------------------------------------------------------------------------
resource pgvectorConfig 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgresServer
  name: 'azure.extensions'
  properties: {
    value: 'vector'
    source: 'user-override'
  }
}

// ---------------------------------------------------------------------------
// Orchestrator database
// ---------------------------------------------------------------------------
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgresServer
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.UTF8'
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output serverFqdn    string = postgresServer.properties.fullyQualifiedDomainName
output serverName    string = postgresServer.name
output databaseName  string = database.name
