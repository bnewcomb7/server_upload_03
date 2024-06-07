const express = require('express');
const serveIndex = require('serve-index');
const http = require('http');
const basicAuth = require('basic-auth');
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');
const formidable = require('formidable');
const moment = require('moment');
const multer = require('multer');
const bodyParser = require('body-parser')
require('moment-timezone/builds/moment-timezone-with-data');

const port = 8080;
const app = express();
app.use(express.json())

app.get('/index', (req, res) => {
    res.sendFile(path.join(__dirname, 'pages', 'index.html'));
});

app.get('/table', (req, res) => {
    res.sendFile(path.join(__dirname, 'pages', 'file_table.html'));
});

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Allow CORS for all routes
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    next();
});

// Directories
const uploadDirectory = '/home/mitnano/Tool_Logs'; // Server upload directory
// const targetDirectory = '/home/mitnano/Desktop/test_tool_logs'; // Simulated target directory
let fileNameKeyPath = path.join(__dirname, 'public', 'fname_key.txt'); // Where to store key to file data
//app.use('/explorer', express.static(uploadDirectory), serveIndex(uploadDirectory, { 'icons': true }));

// Define your username and password
const USERNAME = 'mit.nano';
const PASSWORD = 'key.nano';

// Custom middleware to check username and password
const auth = (req, res, next) => {
    const credentials = basicAuth(req);

    // Check if credentials are valid
    if (!credentials || credentials.name !== USERNAME || credentials.pass !== PASSWORD) {
        res.set('WWW-Authenticate', 'Basic realm="Authorization Required"');
        return res.sendStatus(401);
    }
    // If credentials are correct, proceed
    next();
};

// Apply auth middleware to the /explorer and /public routes
app.use('/public', auth, express.static('public'), serveIndex('public', { 'icons': true }));
app.use('/explorer', auth, express.static(uploadDirectory), serveIndex(uploadDirectory, { 'icons': true }));

// User Options
const userInputOptions = {
    key: "jhgfuesgoergb", 
    uploadInterval: 2 * 1000, 
    rename_with_date: false,
    upload_existing_files: false,
    tool_key: "server",
    all_txt_ext: true
};

// Function to initialize values with user options or defaults
function initializeOptions(userOptions) {
    const defaultOptions = {
        key: "jhgfuesgoergb",
        checkInterval: 0.5 * 1000, // Check every 0.5 seconds
        uploadInterval: 3 * 1000, // Upload every 3 seconds
        rename_with_date: false, // Add datetime to file name in uploads folder
        upload_existing_files: false, // Save files already in targetDirectory on start
        allowedExtensions: ['.txt', '.log', '.csv', '.xls', '.pdf', '.doc', '.docx', '.jpg', '.png'], // Only save files with these extensions
        tool_key: "unspecified", // User did not specify tool_key in userInputOptions
        all_txt_ext: false // Do not add .txt to file names by default
    };

    return Object.assign({}, defaultOptions, userOptions);
}

// Initialize options
const options = initializeOptions(userInputOptions);

// let previousFiles = [];
// let changedFiles = [];
// let addonData = {};
// initialized = false;

// Set up storage engine
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDirectory); // Save files to 'uploads/' directory (resorted later)
    },
    filename: (req, file, cb) => {
      const dateString = moment().tz('America/New_York').format('YYYY-MM-DD_HH-mm-ss');
      const fileExtension = path.extname(file.originalname);
      let fileName = file.originalname;
    //   if (req.body.rename_with_date === 'true') {
    //     fileName = `${dateString}_${path.basename(file.originalname, fileExtension)}${fileExtension}`;
    //   }
    //   if (req.body.all_txt_ext === 'true') {
    //     fileName = `${fileName}.txt`;
    //   }
      cb(null, fileName);
    }
});

const upload = multer({ storage: storage, limits: { fileSize: 500 * 1024 * 1024 }});

async function appendFileNameKey(addonData) {
    addonData_reorder = {
        new_filename: addonData.new_filename,
        original_filename: addonData.original_filename,
        tool: addonData.tool,
        date_time: addonData.date_time,
        size_bytes: addonData.size_bytes,
        path_server: addonData.path_server,
        original_filepath: addonData.original_filepath,
        original_fileext: addonData.original_fileext,
        timestamp: addonData.timestamp,
        IP: addonData.IP,
        req_headers: addonData.req_headers
    }
    try {
        var file_key_text = ',\n' + JSON.stringify(addonData_reorder, null, 4);
        fs.appendFileSync(fileNameKeyPath, file_key_text);
        // console.log('The key data was appended to file!');
      } catch (err) {
        console.log(err)
        console.log('Data NOT appended.')
      }
}

// Custom middleware to check key before uploading file
function checkKey(req, res, next) {
    let addonData;
    try {
        addonData = JSON.parse(req.body.addonData);
    } catch (error) {
        return res.status(400).send('Invalid JSON in addonData');
    }
    
    if (addonData.key === options.key || addonData.key === "admin_key" || addonData.key === "key.nano") {
        next(); // Key matches, proceed to upload
    } else {
        res.status(403).send('Unauthorized Key'); // Key doesn't match, send forbidden status
    }
}

app.post('/upload', upload.single('file'), checkKey, (req, res) => {
    let addonData = JSON.parse(req.body.addonData);
    const file = req.file;

    addonData.new_filename = file.filename;
    addonData.path_server = file.path;
    addonData.size_bytes = file.size;
    addonData.IP = req.ip;
    addonData.req_headers = req.headers;

    // Check if addonData.tool is a string and a valid directory name
    if (typeof addonData.tool === 'string' && /^[a-zA-Z0-9-_]+$/.test(addonData.tool)) {
        // Sort file to subdir
        const newDirectory = path.join(uploadDirectory, addonData.tool);

        // Create the directory if it doesn't exist
        if (!fs.existsSync(newDirectory)) {
            fs.mkdirSync(newDirectory, { recursive: true });
        }

        // Define the new path of the file
        const newPath = path.join(newDirectory, file.filename);

        // Move the file to the new directory
        fs.renameSync(file.path, newPath);

        // Update addonData.path_server to the new location
        addonData.path_server = newPath;
    }

    appendFileNameKey(addonData)

    res.json({
        message: `Successfully uploaded ${file.filename}`,
        addonData: addonData
    });
});
// GET route for redirecting main page to index
app.get('/', (req, res) => {
    res.redirect('/index');
});

// GET route for serving index.html
app.get('/index', (req, res) => {
    res.sendFile(path.join(__dirname, 'pages', 'index.html'));
});

// GET route for displaying uploaded files
app.get('/files', (req, res) => {
    fs.readdir(uploadDirectory, (err, files) => {
        if (err) {
            console.error('Failed to list upload directory:', err);
            return res.sendStatus(500);
        }

        let fileLinks = files.map(file => `<li>${file}</li>`).join('');
        res.send(`
            <h2>Uploaded Files</h2>
            <ul>${fileLinks}</ul>
        `);
    });
});

// app.get('/upload', (req, res) => {
//     // Handle GET requests to /upload route
//     res.send('GET request to /upload endpoint.');
// });

// Start the server
app.listen(port, () => {
    // Call checkForChanges to initialize previousFiles with the files in the target directory
    // checkForChanges();

    // // Set intervals for checking changes and uploading files
    // setInterval(checkForChanges, options.checkInterval);
    // setInterval(uploadFromTarget, options.uploadInterval);

    console.log(`Server running at http://10.19.0.246:${port}`);
    // console.log('Monitoring files saved to ' + targetDirectory + '\n');
});
