import { Account, Client, TablesDB } from "appwrite";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;

if (!endpoint || !projectId) {
  throw new Error("Missing Appwrite configuration");
}

export const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId);

export const account = new Account(client);
export const tablesDB = new TablesDB(client);
export async function getAppwriteJWT() {
  const result = await account.createJWT();
  return result.jwt;
}


export async function ensureUserSession() {
  try {
    // Reuse an existing authenticated or anonymous session.
    const user = await account.get();
    return user;
  } catch {
    // No valid session: create an anonymous one.
    await account.createAnonymousSession();

    // Retrieve the newly created user's details.
    const user = await account.get();
    return user;
  }
}

export async function getTestJWT() {
  await ensureUserSession();

  const result = await account.createJWT();

  return result.jwt;
}