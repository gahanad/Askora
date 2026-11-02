
import { Account, Client, TablesDB } from "appwrite";

export function createUserAppwriteClient(jwt: string) {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;

  if (!endpoint || !projectId) {
    throw new Error("Missing Appwrite configuration.");
  }

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setJWT(jwt);

  return {
    account: new Account(client),
    tablesDB: new TablesDB(client),
  };
}
