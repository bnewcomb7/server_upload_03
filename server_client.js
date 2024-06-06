const express = require('express');
const http = require('http');
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');
const moment = require('moment');
require('moment-timezone/builds/moment-timezone-with-data');

const port = 8080;
const app = express();
app.use(express.json());

// Directories
const uploadDirectory = `http://10.19.0.246:${port}/upload`; // Server upload directory
const targetDirectories = [
    '/Users/benjaminnewcomb/Desktop/MIT.nano/Projects/test_tool_logs_2',
    '/Users/benjaminnewcomb/Desktop/MIT.nano/Projects/test_tool_logs',
];
let fileNameKeyPath = path.join(__dirname, 'public', 'fname_key.txt'); // Where to store key to file data

// User Options
const userInputOptions = {
    key: "jhgfuesgoergb",
    uploadInterval: 3 * 1000,
    rename_with_date: false,
    upload_existing_files: false,
    tool_key: "MLA_test",
    all_txt_ext: true
};

// Function to initialize values with user options or defaults
function initializeOptions(userOptions) {
    const defaultOptions = {
        key: "jhgfuesgoergb",
        checkInterval: 1 * 1000, // Check every 1 seconds
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

let previousFiles = {};
let changedFiles = [];
let addonData = {};
let initialized = false;
let directories_initialized = 0;

// Initialize previousFiles for each target directory
targetDirectories.forEach(directory => {
    previousFiles[directory] = [];
});

if (!fs.existsSync(uploadDirectory)) {
    console.log(`Warning: Need to create or change upload directory. ${uploadDirectory}`);
}
targetDirectories.forEach(directory => {
    if (!fs.existsSync(directory)) {
        console.log(`Warning: Need to create or change target directory. ${directory}`);
    }
});

// Recursively get files from a directory
function getFilesRecursively(directory) {
    let files = [];

    fs.readdirSync(directory).forEach(file => {
        const fullPath = path.join(directory, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            files = files.concat(getFilesRecursively(fullPath));
        } else {
            files.push({ name: file, path: fullPath, mtime: stats.mtimeMs });
        }
    });

    return files;
}

// Check for changes in the target directories
function checkForChanges() {
    targetDirectories.forEach(targetDirectory => {
        let currentFiles = getFilesRecursively(targetDirectory).map(file => {
            return { 
                name: file.name, 
                path: file.path, 
                mtime: file.mtime, 
                directory: path.dirname(file.path).replace(targetDirectory, '') 
            };
        });

        // Initialize previousFiles if empty
        if (!initialized && !options.upload_existing_files) {
            previousFiles[targetDirectory] = [...currentFiles];

            directories_initialized++;
            if (!initialized && directories_initialized === targetDirectories.length) {
                initialized = true;
            }
            return;
        }

        // Determine new or updated files
        let updates = currentFiles.filter(file => {
            let prev = (previousFiles[targetDirectory] || []).find(f => f.path === file.path);
            return !prev || file.mtime > prev.mtime;
        });

        if (updates.length > 0) {
            updates.forEach(file => {
                if (!changedFiles.find(f => f.path === file.path)) {
                    // Check if the file extension is allowed
                    const fileExtension = path.extname(file.name);
                    if (options.allowedExtensions.includes(fileExtension.toLowerCase())) {
                        changedFiles.push(file);
                    } else {
                        console.log(`File '${file.name}' in '${file.directory}' has an invalid extension and will not be uploaded.`);
                    }
                }
            });
            console.log('Detected new or updated files:', updates.map(f => `${f.directory}/${f.name}`));
        }
        previousFiles[targetDirectory] = [...currentFiles];
    });
}

// Upload a file from changedFiles
function uploadFromTarget() {
    if (changedFiles.length === 0) {
        console.log('No files to upload.');
        return;
    }

    let file = changedFiles.shift();
    let sourcePath = file.path;

    uploadFile(sourcePath, uploadDirectory, file, addonData);

    console.log(`Files waiting to upload: ${changedFiles.map(f => `${f.directory}/${f.name}`)}`);
}

async function uploadFile(filePath, uploadUrl, file, addonData) {
    try {
        // Read file content asynchronously
        const fileBuffer = await fs.promises.readFile(filePath);

        // Create a new FormData instance
        const formData = new FormData();

        // Get the current time in Eastern Time (ET) using Moment.js
        const dateString = moment().tz('America/New_York').format('YYYY-MM-DD_HH-mm-ss');
        const fileExtension = path.extname(file.name);

        addonData.original_filename = file.name;
        addonData.original_filepath = filePath;
        addonData.original_fileext = fileExtension;
        addonData.tool = options.tool_key;
        addonData.timestamp = moment().valueOf();
        addonData.date_time = dateString;
        addonData.key = options.key;

        // Include subdirectory structure in file name
        let subDirPath = file.directory.split(path.sep).filter(part => part).join('-');
        let newFileName = subDirPath ? `${subDirPath}-${file.name}` : file.name;

        if (options.rename_with_date) {
            newFileName = `${dateString}_${path.basename(newFileName, fileExtension)}${fileExtension}`;
        }
        if (options.all_txt_ext) {
            newFileName = `${newFileName}.txt`;
        }

        // Append file and addonData to formData
        formData.append('file', fileBuffer, newFileName);
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

        console.log(`Successfully uploaded ${newFileName}`);
    } catch (error) {
        console.error('Error uploading file:', error);
    }
}

app.get('/upload', (req, res) => {
    // Handle GET requests to /upload route
    res.send('GET request to /upload endpoint.');
});

// Start the server
app.listen(port, () => {
    // Call checkForChanges to initialize previousFiles with the files in the target directories
    checkForChanges();

    // Set intervals for checking changes and uploading files
    setInterval(checkForChanges, options.checkInterval);
    setInterval(uploadFromTarget, options.uploadInterval);

    console.log(`Server running at http://10.19.0.246:${port}\n`);
    console.log('Monitoring files saved to the following directories:');
    targetDirectories.forEach(directory => console.log(directory));
});
