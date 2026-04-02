targetScope = 'resourceGroup'

param location string
param keyVaultName string

@allowed(['dev', 'staging', 'prod'])
param environment string

// Secrets passed as an array of { name: string, value: string } objects.
// Using an array avoids the objectKeys() / items() ambiguity across Bicep versions.
param secrets array = []

// ---------------------------------------------------------------------------
// Managed Identity — shared by all ACA apps to pull from Key Vault and ACR
// ---------------------------------------------------------------------------
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${keyVaultName}-identity'
  location: location
}

// ---------------------------------------------------------------------------
// Key Vault
// ---------------------------------------------------------------------------
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: environment == 'prod' ? 'premium' : 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: environment == 'prod' ? 90 : 7
    publicNetworkAccess: 'Enabled'
  }
}

// ---------------------------------------------------------------------------
// RBAC: grant managed identity the "Key Vault Secrets User" built-in role
// ---------------------------------------------------------------------------
resource secretsUserRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentity.id, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    // Key Vault Secrets User — 4633458b-17de-408a-b874-0445c86b69e6
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Secrets — iterate over the array param
// ---------------------------------------------------------------------------
resource kvSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [
  for secret in secrets: {
    parent: keyVault
    name: secret.name
    properties: {
      value: secret.value
    }
  }
]

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output keyVaultUri string = keyVault.properties.vaultUri
output managedIdentityId string = managedIdentity.id
output managedIdentityClientId string = managedIdentity.properties.clientId
output managedIdentityPrincipalId string = managedIdentity.properties.principalId
