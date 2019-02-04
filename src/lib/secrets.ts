import { AuthenticationContext } from "adal-node";
import { KeyVaultClient, KeyVaultCredentials } from "azure-keyvault";
import { mapDefined } from "../util/util";
import { azureKeyvault } from "./settings";

export enum Secret {
    /**
     * Used to upload blobs.
     * To find (or refresh) this value, go to https://ms.portal.azure.com -> All resources -> typespublisher -> General -> Access keys
     */
    AZURE_STORAGE_ACCESS_KEY,
    /**
     * Lets the server update an issue (https://github.com/Microsoft/types-publisher/issues/40) on GitHub in case of an error.
     * Create a token at: https://github.com/settings/tokens
     */
    GITHUB_ACCESS_TOKEN,
    /**
     * This is used to ensure that only GitHub can send messages to our server.
     * This should match the secret value set on GitHub: https://github.com/DefinitelyTyped/DefinitelyTyped/settings/hooks
     * The Payload URL should be the URL of the Azure service.
     * The webhook ignores the `sourceRepository` setting and can be triggered by *anything* with the secret,
     * so make sure only DefinitelyTyped has the secret.
     */
    GITHUB_SECRET,
    /**
     * Token used to perform request to NPM's API.
     * This was generated by doing:
     * - `npm login`
     * - copy the token value (comes after `authToken=`) in `~/.npmrc`
     * - `rm ~/.npmrc` (don't want to accidentally log out this token.)
     *
     * We only need one token in existence, so delete old tokens at: https://www.npmjs.com/settings/tokens
     */
    NPM_TOKEN,
}

export const allSecrets: Secret[] = mapDefined(Object.keys(Secret), key => {
    const value = (Secret as { [key: string]: unknown })[key];
    return typeof value === "number" ? value : undefined; // tslint:disable-line strict-type-predicates (tslint bug)
});

export async function getSecret(secret: Secret): Promise<string> {
    const clientId = process.env.TYPES_PUBLISHER_CLIENT_ID;
    const clientSecret = process.env.TYPES_PUBLISHER_CLIENT_SECRET;
    if (!(clientId && clientSecret)) {
        throw new Error("Must set the TYPES_PUBLISHER_CLIENT_ID and TYPES_PUBLISHER_CLIENT_SECRET environment variables.");
    }

    // Copied from example usage at https://www.npmjs.com/package/azure-keyvault
    const credentials = new KeyVaultCredentials((challenge, callback) => {
        const context = new AuthenticationContext(challenge.authorization);
        context.acquireTokenWithClientCredentials(challenge.resource, clientId, clientSecret, (error, tokenResponse) => {
            if (error) {
                throw error;
            }
            callback(undefined, `${tokenResponse!.tokenType} ${tokenResponse!.accessToken}`);
        });
    });

    const client = new KeyVaultClient(credentials);

    // Convert `AZURE_STORAGE_ACCESS_KEY` to `azure-storage-access-key` -- for some reason, Azure wouldn't allow secret names with underscores.
    const azureSecretName = Secret[secret].toLowerCase().replace(/_/g, "-");
    console.log("Getting versions for: " + azureSecretName);
    const versions = await client.getSecretVersions(azureKeyvault, azureSecretName);
    versions.sort((a, b) => a.attributes.created < b.attributes.created ? 1 : -1);
    console.log(versions);
    const urlParts = versions[0].id.split("/");
    const latest = urlParts[urlParts.length - 1];
    return (await client.getSecret(azureKeyvault, azureSecretName, latest)).value;
}
