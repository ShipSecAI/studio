import {
  IAMClient,
  ListUsersCommand,
  ListRolesCommand,
  ListPoliciesCommand,
  ListAccessKeysCommand,
  type User,
  type Role,
  type Policy,
  type AccessKeyMetadata,
} from '@aws-sdk/client-iam';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, synthesizeArn } from './aws-utils';

interface IamCursor {
  /** 0=users, 1=roles, 2=policies, 3=access_keys */
  phase: number;
  marker?: string;
  /** For access keys: index into previously fetched user list */
  userIndex?: number;
  users?: string[];
}

const PAGE_SIZE = 100;

export class IamServiceProvider implements AwsServiceProvider {
  serviceId = 'iam';
  assetTypes = ['iam_user', 'iam_role', 'iam_policy', 'iam_access_key'];
  isGlobal = true;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: IamCursor = cursorStr ? JSON.parse(cursorStr) : { phase: 0 };
    const assets: DiscoveredAsset[] = [];
    const region = 'global';

    const client = new IAMClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: context.credentials.accessKeyId,
        secretAccessKey: context.credentials.secretAccessKey,
        sessionToken: context.credentials.sessionToken,
      },
    });

    try {
      let { phase, marker, userIndex, users } = cursor;

      // Phase 0: Users
      if (phase === 0) {
        const result = await withRetry(() =>
          client.send(new ListUsersCommand({ MaxItems: PAGE_SIZE, Marker: marker })),
        );

        for (const user of result.Users ?? []) {
          assets.push(this.mapUser(user, context.accountIdentifier));
        }

        if (result.IsTruncated && result.Marker) {
          return this.page(assets, region, { phase: 0, marker: result.Marker });
        }
        phase = 1;
        marker = undefined;
      }

      // Phase 1: Roles
      if (phase === 1 && assets.length < PAGE_SIZE) {
        const result = await withRetry(() =>
          client.send(new ListRolesCommand({ MaxItems: PAGE_SIZE, Marker: marker })),
        );

        for (const role of result.Roles ?? []) {
          assets.push(this.mapRole(role, context.accountIdentifier));
        }

        if (result.IsTruncated && result.Marker) {
          return this.page(assets, region, { phase: 1, marker: result.Marker });
        }
        phase = 2;
        marker = undefined;
      }

      // Phase 2: Customer-managed policies only
      if (phase === 2 && assets.length < PAGE_SIZE) {
        const result = await withRetry(() =>
          client.send(
            new ListPoliciesCommand({ MaxItems: PAGE_SIZE, Scope: 'Local', Marker: marker }),
          ),
        );

        for (const policy of result.Policies ?? []) {
          assets.push(this.mapPolicy(policy, context.accountIdentifier));
        }

        if (result.IsTruncated && result.Marker) {
          return this.page(assets, region, { phase: 2, marker: result.Marker });
        }
        phase = 3;
        marker = undefined;
        userIndex = 0;
      }

      // Phase 3: Access keys (iterate all users)
      if (phase === 3 && assets.length < PAGE_SIZE) {
        // Fetch user list on first entry to phase 3
        if (!users) {
          const allUsers: string[] = [];
          let m: string | undefined;
          do {
            const result = await withRetry(() =>
              client.send(new ListUsersCommand({ MaxItems: 1000, Marker: m })),
            );
            for (const u of result.Users ?? []) {
              if (u.UserName) allUsers.push(u.UserName);
            }
            m = result.IsTruncated ? result.Marker : undefined;
          } while (m);
          users = allUsers;
          userIndex = 0;
        }

        while ((userIndex ?? 0) < users.length && assets.length < PAGE_SIZE) {
          const userName = users[userIndex!];
          const result = await withRetry(() =>
            client.send(new ListAccessKeysCommand({ UserName: userName })),
          );

          for (const key of result.AccessKeyMetadata ?? []) {
            assets.push(this.mapAccessKey(key, context.accountIdentifier));
          }
          userIndex = (userIndex ?? 0) + 1;
        }

        if ((userIndex ?? 0) < users.length) {
          return this.page(assets, region, { phase: 3, userIndex, users });
        }
      }

      // All phases done
      return {
        assets,
        nextCursor: undefined,
        scannedScopes: this.assetTypes.map((t) => ({ assetType: t, region })),
      };
    } finally {
      client.destroy();
    }
  }

  private page(assets: DiscoveredAsset[], region: string, cursor: IamCursor): ServiceDiscoveryPage {
    return {
      assets,
      nextCursor: JSON.stringify(cursor),
      scannedScopes: this.assetTypes.map((t) => ({ assetType: t, region })),
    };
  }

  private mapUser(user: User, _accountId: string): DiscoveredAsset {
    return {
      assetType: 'iam_user',
      externalId: user.Arn!,
      name: user.UserName!,
      region: 'global',
      metadata: {
        userId: user.UserId,
        path: user.Path,
        createDate: user.CreateDate?.toISOString(),
        passwordLastUsed: user.PasswordLastUsed?.toISOString(),
      },
    };
  }

  private mapRole(role: Role, _accountId: string): DiscoveredAsset {
    return {
      assetType: 'iam_role',
      externalId: role.Arn!,
      name: role.RoleName!,
      region: 'global',
      metadata: {
        roleId: role.RoleId,
        path: role.Path,
        createDate: role.CreateDate?.toISOString(),
        maxSessionDuration: role.MaxSessionDuration,
        description: role.Description,
      },
    };
  }

  private mapPolicy(policy: Policy, _accountId: string): DiscoveredAsset {
    return {
      assetType: 'iam_policy',
      externalId: policy.Arn!,
      name: policy.PolicyName!,
      region: 'global',
      metadata: {
        policyId: policy.PolicyId,
        path: policy.Path,
        createDate: policy.CreateDate?.toISOString(),
        updateDate: policy.UpdateDate?.toISOString(),
        attachmentCount: policy.AttachmentCount,
        isAttachable: policy.IsAttachable,
        defaultVersionId: policy.DefaultVersionId,
      },
    };
  }

  private mapAccessKey(key: AccessKeyMetadata, accountId: string): DiscoveredAsset {
    const externalId = synthesizeArn({
      service: 'iam',
      region: 'global',
      accountId,
      resourceType: 'access-key',
      resourceId: `${key.UserName}/${key.AccessKeyId}`,
    });

    return {
      assetType: 'iam_access_key',
      externalId,
      name: `${key.UserName}/${key.AccessKeyId}`,
      region: 'global',
      metadata: {
        accessKeyId: key.AccessKeyId,
        userName: key.UserName,
        status: key.Status,
        createDate: key.CreateDate?.toISOString(),
      },
    };
  }
}
