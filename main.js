const fs = require('fs').promises;
const path = require("path");
const promisify = require("util").promisify;
const readline = require('readline');
const { google } = require('googleapis');
const paths = require("./paths");
function questionAsync(readline, message)
{
    return new Promise(resolve =>
        {
            readline.question(message, answer => resolve(answer));
        }
    );
}


// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/drive'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';
const JSON_MIME_TYPE = "application/json";

/**
 * Reads 'credentials.json' and returns credential object.
 * @returns {Object} The authorization client credentials.
 */
async function getCredentials()
{
    const content = await fs.readFile("credentials.json");
    return JSON.parse(content);
}

/**
 * Gets and stores new token after prompting for user authorization.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @returns {Credentials} Access token.
 */
async function getAccessToken(oAuth2Client)
{
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const code = await questionAsync(rl, 'Enter the code from that page here: ');
    rl.close();
    return await promisify(oAuth2Client.getToken).bind(oAuth2Client)(code);
}

/**
 * Create an OAuth2 client with the given credentials.
 * @returns {google.auth.OAuth2} The OAuth2 client.
 */
async function getAuth()
{
    const credentials = await getCredentials();
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
    );

    try
    {
        const tokenContent = await fs.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(tokenContent));
        return oAuth2Client;
    }
    catch (e)
    {
        const token = getAccessToken(oAuth2Client);
        oAuth2Client.setCredentials(token);
        // Store the token to disk for later program executions.
        await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
        console.log('Token stored to', TOKEN_PATH);
        return oAuth2Client;
    }
}

async function uploadFiles(auth)
{
    console.log("Begin: upload");

    const drive = google.drive({version: 'v3', auth});

    for (const localFilePath of paths.localFilePaths)
    {
        const filename = path.basename(localFilePath);
        // 'file ID' if the file exists, 'null' if not.
        const fileId = await (async function () {
            let pageToken = null;
            while (true)
            {
                const listResult = await drive.files.list({
                    fields: "nextPageToken, files(id)",
                    q: `name = '${filename}' and '${paths.dstFolderId}' in parents and trashed = false`,
                    pageToken
                });
                
                if ((listResult.data.files ?? []).length > 0)
                {
                    return listResult.data.files[0].id;
                }
                pageToken = listResult.data.nextPageToken;
                if (pageToken == null)
                {
                    return null;
                }
            }
        })();
        
        const content = (await fs.readFile(localFilePath)).toString();

        if (fileId == null)
        {
            // Upload new file.
            drive.files.create({
                requestBody: {
                    name: filename,
                    parents: [paths.dstFolderId],
                    mimeType: JSON_MIME_TYPE
                },
                media: {
                    mimeType: JSON_MIME_TYPE,
                    body: content
                }
            });
        }
        else
        {
            // Update the existing file.
            drive.files.update({
                fileId,
                media: {
                    mimeType: JSON_MIME_TYPE,
                    body: content
                }
            });
        }
    }

    console.log("End: upload");
}

async function main()
{
    const auth = await getAuth();
    await uploadFiles(auth);
}

(async () => await main())();