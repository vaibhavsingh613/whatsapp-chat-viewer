
const fileInput = document.getElementById("chatFile");
const status = document.getElementById("status");
const preview = document.getElementById("preview");
const fileType = document.getElementById("fileType");
const parsedPreview = document.getElementById("parsedPreview");
const messageCount = document.getElementById("messageCount");

const chatMessages = document.getElementById("chatMessages");
const chatTotal = document.getElementById("chatTotal");

const leftPerson = document.getElementById("leftPerson");
const rightPerson = document.getElementById("rightPerson");
const messageSearch = document.getElementById("messageSearch");
const senderFilter = document.getElementById("senderFilter");
const chatTitle = document.getElementById("chatTitle");

let parsedMessages = [];
let mediaFiles = new Map();
let createdObjectUrls = [];

function clearMediaUrls() {
    createdObjectUrls.forEach(url => URL.revokeObjectURL(url));
    createdObjectUrls = [];
    mediaFiles.clear();
}

function getBaseName(path) {
    return path.split("/").pop().toLowerCase();
}

function findMediaForMessage(message) {
    const lowerMessage = (message || "").toLowerCase();
    for (const [baseName, media] of mediaFiles.entries()) {
        if (baseName && lowerMessage.includes(baseName)) return media;
    }
    return null;
}

function removeMediaFilename(message, media) {
    if (!media) return message;
    const escaped = media.baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return message.replace(new RegExp(escaped, "ig"), "")
        .replace(/\s*\(file attached\)/ig, "").trim();
}

function isOmittedMediaMessage(message) {
    return /(?:media|image|video|audio|sticker|gif|document)\s+omitted|<media omitted>/i.test(message || "");
}

function classifyMediaFile(fileName) {
    const name = fileName.toLowerCase();
    const ext = name.split(".").pop();
    if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"].includes(ext)) {
        return { kind: "image", isGif: ext === "gif" };
    }
    if (["mp4", "mov", "webm", "m4v"].includes(ext)) {
        return { kind: "video", isGif: /gif/i.test(name) };
    }
    if (["mp3", "m4a", "aac", "ogg", "opus", "wav"].includes(ext)) return { kind: "audio" };
    if (["pdf", "doc", "docx", "zip"].includes(ext)) return { kind: "file" };
    return null;
}

function renderMediaElement(media) {
    let element;
    if (media.kind === "image") {
        element = document.createElement("img");
        element.src = media.url;
        element.alt = "Shared image or sticker";
        element.loading = "lazy";
        element.className = "chat-media-image";
    } else if (media.kind === "video") {
        element = document.createElement("video");
        element.src = media.url;
        element.controls = true;
        element.preload = "metadata";
        element.className = "chat-media-video";
        if (media.isGif) {
            element.loop = true;
            element.muted = true;
            element.autoplay = true;
            element.playsInline = true;
            element.controls = false;
        }
    } else if (media.kind === "audio") {
        element = document.createElement("audio");
        element.src = media.url;
        element.controls = true;
        element.preload = "metadata";
        element.className = "chat-media-audio";
    } else {
        element = document.createElement("a");
        element.href = media.url;
        element.download = media.baseName;
        element.textContent = "Download " + media.baseName;
        element.className = "chat-media-file";
    }
    return element;
}


// STEP 1: Read the selected TXT or ZIP file

fileInput.addEventListener("change", async function () {
    const file = fileInput.files[0];

    if (!file) return;

    clearMediaUrls();
    preview.textContent = "";
    parsedPreview.textContent = "";
    messageCount.textContent = "0 messages";
    fileType.textContent = "Processing...";
    status.textContent = "Reading your file...";

    try {
        let chatText = "";
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith(".txt")) {
            chatText = await file.text();

        } else if (fileName.endsWith(".zip")) {
            if (typeof JSZip === "undefined") {
                throw new Error(
                    "ZIP library load nahi hui. Internet check karo."
                );
            }

            const zip = await JSZip.loadAsync(file);

            const textFiles = Object.values(zip.files).filter(
                entry =>
                    !entry.dir &&
                    entry.name.toLowerCase().endsWith(".txt")
            );

            if (textFiles.length === 0) {
                throw new Error("ZIP ke andar TXT file nahi mili.");
            }

            // Prefer the WhatsApp transcript, often named _chat.txt
            const chatFile = textFiles.find(entry =>
                /(?:_chat|whatsapp chat).*\.txt$/i.test(entry.name.split("/").pop())
            ) || textFiles[0];

            chatText = await chatFile.async("string");

            // Read supported media files from the ZIP. Files stay in this browser.
            const mediaEntries = Object.values(zip.files).filter(entry =>
                !entry.dir && entry !== chatFile && !!classifyMediaFile(entry.name)
            );

            for (const entry of mediaEntries) {
                const blob = await entry.async("blob");
                const url = URL.createObjectURL(blob);
                createdObjectUrls.push(url);
                const baseName = getBaseName(entry.name);
                mediaFiles.set(baseName, {
                    baseName,
                    url,
                    ...classifyMediaFile(entry.name)
                });
            }

        } else {
            throw new Error("Please select a TXT or ZIP file.");
        }

        if (!chatText.trim()) {
            throw new Error("The chat file is empty.");
        }

        // Show original text
        preview.textContent = chatText;

        // Parse the messages
        const messages = parseWhatsAppChat(chatText);
        parsedMessages = messages;

        // Set up the participants and render the chat
        setupParticipants(messages);
        renderChat(messages);

        // Show structured data for debugging
        parsedPreview.textContent = JSON.stringify(
            messages.slice(0, 20),
            null,
            2
        );

        messageCount.textContent = `${messages.length} messages`;

        fileType.textContent = fileName.endsWith(".zip")
            ? "ZIP extracted"
            : "TXT file";

        status.textContent = messages.length > 0
            ? `Loaded ${file.name} successfully.`
            : "File loaded, but no messages were recognized.";

    } catch (error) {
        preview.textContent = "Unable to read this file.";
        parsedPreview.textContent = "Parsing failed.";
        fileType.textContent = "Error";
        status.textContent = error.message;
    }
});


// STEP 2: Parse the WhatsApp chat text

function parseWhatsAppChat(chatText) {
    const lines = chatText
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/);

    const messages = [];
    let currentMessage = null;

    // Recognizes common WhatsApp date and time formats
    const messageStartRegex =
        /^\u200e?\[?(\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\]?\s*(?:-\s*)?(.*)$/i;

    for (const line of lines) {
        const match = line.match(messageStartRegex);

        if (match) {
            // Save the previous message
            if (currentMessage !== null) {
                messages.push(currentMessage);
            }

            const date = match[1];
            const time = match[2].trim();
            const remainingText = match[3];

            // Separate sender name from message content
            const senderMatch = remainingText.match(
                /^([^:\n]+):\s?([\s\S]*)$/
            );

            if (senderMatch) {
                currentMessage = {
                    date: date,
                    time: time,
                    sender: senderMatch[1].trim(),
                    message: senderMatch[2],
                    type: "chat"
                };
            } else {
                // System notification, such as a group change
                currentMessage = {
                    date: date,
                    time: time,
                    sender: null,
                    message: remainingText,
                    type: "system"
                };
            }

        } else if (currentMessage !== null) {
            // Keep additional lines in the same message
            currentMessage.message += "\n" + line;
        }
    }

    // Save the last message
    if (currentMessage !== null) {
        messages.push(currentMessage);
    }

    return messages;
}


// STEP 3: Identify participants and fill dropdowns

function setupParticipants(messages) {
    const participants = [
        ...new Set(
            messages
                .filter(msg => msg.type === "chat" && msg.sender)
                .map(msg => msg.sender.trim())
                .filter(Boolean)
        )
    ];

    // Reset participant dropdowns
    leftPerson.replaceChildren();
    rightPerson.replaceChildren();

    leftPerson.add(new Option("Select person", ""));
    rightPerson.add(new Option("Select person", ""));

    participants.forEach(person => {
        leftPerson.add(new Option(person, person));
        rightPerson.add(new Option(person, person));
    });

    // Automatically select the first two participants
    leftPerson.value = participants[0] || "";
    rightPerson.value = participants[1] || "";

    // Reset sender filter
    senderFilter.replaceChildren();
    senderFilter.add(new Option("All senders", ""));

    participants.forEach(person => {
        senderFilter.add(new Option(person, person));
    });

    if (messages.some(msg => msg.type === "system")) {
        senderFilter.add(new Option("System messages", "__system__"));
    }

    updateChatTitle();
}


// STEP 4: Update the chat heading

function updateChatTitle() {
    const leftName = leftPerson.value || "Left person";
    const rightName = rightPerson.value || "Right person";

    chatTitle.textContent = `${leftName} ↔ ${rightName}`;
}


// STEP 5: Display messages as chat bubbles

function renderChat(messages) {
    chatMessages.replaceChildren();

    const searchText = messageSearch.value.trim().toLowerCase();
    const selectedSender = senderFilter.value;
    const rightName = rightPerson.value;

    // Apply search and sender filters
    const visibleMessages = messages.filter(msg => {
        const isSystem = msg.type === "system";

        if (selectedSender === "__system__" && !isSystem) {
            return false;
        }

        if (
            selectedSender &&
            selectedSender !== "__system__" &&
            msg.sender !== selectedSender
        ) {
            return false;
        }

        const searchableText = [
            msg.sender || "",
            msg.message || "",
            msg.date || "",
            msg.time || ""
        ].join(" ").toLowerCase();

        return searchableText.includes(searchText);
    });

    chatTotal.textContent =
        `${visibleMessages.length} of ${messages.length} messages`;

    if (visibleMessages.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-chat";
        empty.textContent = messages.length === 0
            ? "No messages found in this chat."
            : "No messages match your search or filter.";

        chatMessages.appendChild(empty);
        updateChatTitle();
        return;
    }

    let previousDate = null;

    visibleMessages.forEach(msg => {
        // Add a date separator when the date changes
        if (msg.date !== previousDate) {
            const dateLabel = document.createElement("div");
            dateLabel.className = "chat-date";
            dateLabel.textContent = formatChatDate(msg.date);

            chatMessages.appendChild(dateLabel);
            previousDate = msg.date;
        }

        // Display system messages separately
        if (msg.type === "system") {
            const system = document.createElement("div");
            system.className = "system-message";
            system.textContent = `${msg.message} · ${msg.time}`;

            chatMessages.appendChild(system);
            return;
        }

        const sender = (msg.sender || "").trim();

        // The selected right-side person's messages go right.
        // Other participants' messages go left.
        const isOutgoing =
            rightName !== "" && sender === rightName;

        const row = document.createElement("div");
        row.className = isOutgoing
            ? "message-row outgoing"
            : "message-row incoming";

        const bubble = document.createElement("div");
        bubble.className = "message-bubble";

        // Show sender name on the left-side messages
        if (!isOutgoing && sender) {
            const name = document.createElement("div");
            name.className = "sender-name";
            name.textContent = sender;
            name.style.color = getSenderColor(sender);

            bubble.appendChild(name);
        }

        // Display message text and any media whose filename appears in the transcript
        const media = findMediaForMessage(msg.message);
        const cleanText = media ? removeMediaFilename(msg.message, media) : msg.message;

        if (cleanText) {
            const text = document.createElement("div");
            text.className = "message-text";
            text.textContent = cleanText;
            bubble.appendChild(text);
        }

        if (media) {
            bubble.appendChild(renderMediaElement(media));
        } else if (isOmittedMediaMessage(msg.message)) {
            const missing = document.createElement("div");
            missing.className = "missing-media";
            missing.textContent = "Media wasn't included or couldn't be matched in this ZIP.";
            bubble.appendChild(missing);
        }

        // Message time
        const time = document.createElement("div");
        time.className = "message-time";
        time.textContent = formatChatTime(msg.time);

        bubble.appendChild(time);
        row.appendChild(bubble);
        chatMessages.appendChild(row);
    });

    updateChatTitle();

    // Scroll to the latest visible message
    chatMessages.scrollTop = chatMessages.scrollHeight;
}


// STEP 6: Respond to dropdown and search changes

[leftPerson, rightPerson, senderFilter].forEach(control => {
    control.addEventListener("change", function () {
        // The same person cannot occupy both sides
        if (
            leftPerson.value &&
            leftPerson.value === rightPerson.value
        ) {
            if (control === leftPerson) {
                rightPerson.value = "";
            } else if (control === rightPerson) {
                leftPerson.value = "";
            }
        }

        renderChat(parsedMessages);
    });
});

messageSearch.addEventListener("input", function () {
    renderChat(parsedMessages);
});


// STEP 7: Format date and time

function formatChatDate(date) {
    return date;
}

function formatChatTime(time) {
    return time
        .replace(/a\.?m\.?/i, "AM")
        .replace(/p\.?m\.?/i, "PM");
}


// STEP 8: Give each participant a consistent color

function getSenderColor(sender) {
    const colors = [
        "#B44B85",
        "#277DA1",
        "#8A5A44",
        "#6A4C93",
        "#36856B",
        "#C05A36"
    ];

    let hash = 0;

    for (let i = 0; i < sender.length; i++) {
        hash = (hash * 31 + sender.charCodeAt(i)) | 0;
    }

    return colors[Math.abs(hash) % colors.length];
}
