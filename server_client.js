const express = require('express');
const serveIndex = require('serve-index');
const http = require('http');
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');
const formidable = require('formidable');
const moment = require('moment');
require('moment-timezone/builds/moment-timezone-with-data');

const port = 8080;
const app = express();
app.use(express.json())

// app.use('/public', express.static('public'));
// app.use('/public', serveIndex('public'));

// // app.use('/upload', express.static('upload')); // Serve files from the upload directory
// // app.use('/upload', serveIndex('upload'));

// app.get('/index', (req, res) => {
//     res.sendFile(path.join(__dirname, 'pages', 'index.html'));
// });

// app.get('/table', (req, res) => {
//     res.sendFile(path.join(__dirname, 'pages', 'file_table.html'));
// });

// // Parse URL-encoded bodies
// app.use(express.urlencoded({ extended: true }));

// // Allow CORS for all routes
// app.use((req, res, next) => {
//     res.setHeader('Access-Control-Allow-Origin', '*');
//     res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
//     res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
//     next();
// });

// Directories
const uploadDirectory = `http://10.19.0.246:${port}/upload`; // Server upload directory
const targetDirectory = '/Users/benjaminnewcomb/Desktop/MIT.nano/Projects/test_tool_logs'; // Simulated target directory
let fileNameKeyPath = path.join(__dirname, 'public', 'fname_key.txt'); // Where to store key to file data

// User Options
const userInputOptions = {
    key: "test_key", 
    uploadInterval: 2 * 1000, 
    rename_with_date: true,
    upload_existing_files: true,
    tool_key: "MLA_test",
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

let previousFiles = [];
let changedFiles = [];
let addonData = {};
initialized = false;

// Set up storage engine
// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//       cb(null, 'uploads/'); // Save files to 'uploads/' directory
//     },
//     filename: (req, file, cb) => {
//       const dateString = moment().tz('America/New_York').format('YYYY-MM-DD_HH-mm-ss');
//       const fileExtension = path.extname(file.originalname);
//       let fileName = file.originalname;
//       if (req.body.rename_with_date === 'true') {
//         fileName = `${dateString}_${path.basename(file.originalname, fileExtension)}${fileExtension}`;
//       }
//       if (req.body.all_txt_ext === 'true') {
//         fileName = `${fileName}.txt`;
//       }
//       cb(null, fileName);
//     }
// });

// const upload = multer({ storage: storage });

if (!fs.existsSync(uploadDirectory)) {
    console.log(`Warning: Need to create or change upload directory. ${uploadDirectory}`);
}
if (!fs.existsSync(targetDirectory)) {
    console.log(`Warning: Need to create or change target directory. ${targetDirectory}`);
}

// Check for changes in the target directory
function checkForChanges() {
    fs.readdir(targetDirectory, (err, files) => {
        if (err) {
            console.error('Failed to read target directory:', err);
            return;
        }

        let currentFiles = files.map(file => {
            let filePath = path.join(targetDirectory, file);
            let stats = fs.statSync(filePath);
            return { name: file, mtime: stats.mtimeMs };
        });

        // Initialize previousFiles if empty
        if (!initialized && !options.upload_existing_files) {
            previousFiles = [...currentFiles];
            initialized = true;
            return;
        }

        // Determine new or updated files
        let updates = currentFiles.filter(file => {
            let prev = previousFiles.find(f => f.name === file.name);
            return !prev || file.mtime > prev.mtime;
        });

        if (updates.length > 0) {
            updates.forEach(file => {
                if (!changedFiles.includes(file.name)) {
                    // Check if the file extension is allowed
                    const fileExtension = path.extname(file.name);
                    if (options.allowedExtensions.includes(fileExtension.toLowerCase())) {
                        changedFiles.push(file.name);
                    } else {
                        console.log(`File '${file.name}' has an invalid extension and will not be uploaded.`);
                    }
                }
            });
            console.log('Detected new or updated files:', updates.map(f => f.name));
        }

        previousFiles = [...currentFiles];
    });
}

// Upload a file from changedFiles
function uploadFromTarget() {
    if (changedFiles.length === 0) {
        console.log('No files to upload.');
        return;
    }

    let fileName = changedFiles.shift();
    let sourcePath = path.join(targetDirectory, fileName);

    uploadFile(sourcePath, uploadDirectory, fileName, addonData);

    console.log(`Files waiting to upload: ${changedFiles}`);
}

async function uploadFile(filePath, uploadUrl, fileName, addonData) {
    try {
        // Read file content asynchronously
        const fileBuffer = await fs.promises.readFile(filePath);

        // Create a new FormData instance
        const formData = new FormData();

        // Get the current time in Eastern Time (ET) using Moment.js
        const dateString = moment().tz('America/New_York').format('YYYY-MM-DD_HH-mm-ss');
        const fileExtension = path.extname(fileName);

        addonData.original_filename = fileName;
        addonData.original_filepath = filePath;
        addonData.original_fileext = fileExtension;
        addonData.tool = options.tool_key;
        addonData.timestamp = moment().valueOf();
        addonData.date_time = dateString;

        if (options.rename_with_date) {
            fileName = `${dateString}_${path.basename(fileName, fileExtension)}${fileExtension}`;
        }
        if (options.all_txt_ext) {
            fileName = `${fileName}.txt`;
        }

        // Append file and addonData to formData
        formData.append('file', fileBuffer, fileName);
        formData.append('addonData', JSON.stringify(addonData));
        formData.append('tool_key', options.tool_key);
        formData.append('rename_with_date', options.rename_with_date.toString());
        formData.append('all_txt_ext', options.all_txt_ext.toString());

        // Perform the fetch request to upload the file
        const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData, // Automatically sets 'Content-Type': 'multipart/form-data'
        });

        // Check the response
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }

        console.log(`Successfully uploaded ${fileName}`);
    } catch (error) {
        console.error('Error uploading file:', error);
    }
}

// async function appendFileNameKey(addonData) {
//     addonData_reorder = {
//         new_filename: addonData.new_filename,
//         original_filename: addonData.original_filename,
//         tool: addonData.tool,
//         date_time: addonData.date_time,
//         size_bytes: addonData.size_bytes,
//         path_server: addonData.path_server,
//         original_filepath: addonData.original_filepath,
//         original_fileext: addonData.original_fileext,
//         timestamp: addonData.timestamp,
//         IP: addonData.IP,
//         req_headers: addonData.req_headers
//     }
//     try {
//         var file_key_text = ',\n' + JSON.stringify(addonData_reorder, null, 4);
//         fs.appendFileSync(fileNameKeyPath, file_key_text);
//         // console.log('The key data was appended to file!');
//       } catch (err) {
//         console.log(err)
//         console.log('Data NOT appended.')
//       }
// }


// app.post('/upload', upload.single('file'), (req, res) => {
//     let addonData = JSON.parse(req.body.addonData);
//     const file = req.file;

//     addonData.original_filename = file.originalname;
//     addonData.original_filepath = file.path;
//     addonData.original_fileext = path.extname(file.originalname);
//     addonData.tool = req.body.tool_key;
//     addonData.timestamp = moment().valueOf();
//     addonData.date_time = moment().tz('America/New_York').format('YYYY-MM-DD_HH-mm-ss');

//     addonData.new_filename = files.file[0].newFilename;
//     addonData.path_server = files.file[0].filepath;
//     addonData.size_bytes = files.file[0].size;
//     addonData.IP = req.ip;
//     addonData.req_headers = req.headers;

//     appendFileNameKey(addonData)

//     res.json({
//         message: `Successfully uploaded ${file.filename}`,
//         addonData: addonData
//     });
// });

// GET route for displaying uploaded files
// app.get('/', (req, res) => {
//     fs.readdir(uploadDirectory, (err, files) => {
//         if (err) {
//             console.error('Failed to list upload directory:', err);
//             return res.sendStatus(500);
//         }

//         let fileLinks = files.map(file => `<li>${file}</li>`).join('');
//         res.send(`
//             <h2>Uploaded Files</h2>
//             <ul>${fileLinks}</ul>
//         `);
//     });
// });

app.get('/upload', (req, res) => {
    // Handle GET requests to /upload route
    res.send('GET request to /upload endpoint.');
});

// Start the server
app.listen(port, () => {
    // Call checkForChanges to initialize previousFiles with the files in the target directory
    checkForChanges();

    // Set intervals for checking changes and uploading files
    setInterval(checkForChanges, options.checkInterval);
    setInterval(uploadFromTarget, options.uploadInterval);

    console.log(`Server running at http://10.19.0.246:${port}`);
    console.log('Monitoring files saved to ' + targetDirectory + '\n');
});
