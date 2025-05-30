const { sendEmail } = require('./lib/EmailUtils');
const handlebars = require("handlebars");
const pdf = require('html-pdf-node');
const express = require('express');
const path = require('path');
const cors = require("cors");
const fs = require('fs');
const mongoose = require("mongoose")

const authRouter = require("./routers/AuthRouter");
const uploadRouter = require("./routers/UploadRouter");
const builderRouter = require("./routers/BuilderRouter");
const propertyRouter = require("./routers/PropertyRouter");

const { generateQuotePDF } = require('./lib/PDFUtils');

const initializeDefaultAdmin = require("./lib/AuthUtils");

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ MONGO_URI not found in .env');
    process.exit(1);
}

app.use(cors());
app.use(express.json());

function getCompiledTemplate(templateName, replacements) {
    const filePath = path.join(__dirname, 'public', templateName);
    if (!fs.existsSync(filePath)) {
        console.error(`Template file ${templateName} not found.`);
        return '';
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const template = handlebars.compile(source);
    return template(replacements);
}

app.post('/submit-quote', async (req, res) => {
    const { contactDetails, quoteDetails } = req.body;

    if (!contactDetails || !quoteDetails) {
        return res.status(400).json({ error: 'Contact details and quote details are required.' });
    }

    const timestamp = Date.now();
    const safeName = contactDetails.name.replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
    const fileName = `${safeName}_${timestamp}.pdf`;


    const pdfResp = await generateQuotePDF(contactDetails, quoteDetails);
    let pdfBuffer;
    if (pdfResp.message) {
        pdfBuffer = pdfResp.buffer;
        console.log('PDF generated successfully in memory.');
    } else {
        console.error('Error generating PDF:', e);
        return res.status(500).json(pdfResp.error);
    }

    const adminMailContent = getCompiledTemplate('constrution-request.html', { username: "Admin" });
    const userMailContent = getCompiledTemplate('constrution-request.html', { username: contactDetails.name });

    try {
        console.log('Sending emails...');

        await sendEmail({
            to: ["karnamshyam9009@gmail.com"],
            subject: `A new quote request from ${contactDetails.name}`,
            html: adminMailContent,
            attachments: [{
                filename: fileName,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }]
        });

        // await sendEmail({
        //     to: contactDetails.email,
        //     subject: `Your (${contactDetails.name}) construction has been submitted successfully`,
        //     html: userMailContent,
        //     attachments: [{
        //         filename: fileName,
        //         content: pdfBuffer,
        //         contentType: 'application/pdf'
        //     }]
        // });

        console.log('Emails sent successfully with in-memory PDF.');
        res.status(200).json({ message: 'Emails sent successfully!' });
    } catch (error) {
        console.error('Error sending emails:', error);
        res.status(500).json({ error: 'Error sending emails', reason: error.toString() });
    }
});

app.post('/submit-material-order', async (req, res) => {
    const { materials, contact } = req.body;

    console.dir(materials, { depth: null });

    if (!contact || !materials || !Array.isArray(materials)) {
        return res.status(400).json({ error: 'Contact and materials are required.' });
    }

    const timestamp = Date.now();
    const safeName = contact.name.replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
    const fileName = `${safeName}_material_order_${timestamp}.pdf`;

    const htmlContent = `
    <html>
    <head>
        <style>
            body {
                font-family: Arial, sans-serif;
                padding: 40px;
                position: relative;
            }
            .watermark {
                position: fixed;
                top: 35%;
                left: 50%;
                transform: translate(-50%, -50%) rotate(-30deg);
                opacity: 0.2;
                width: 70%;
                z-index: 0;
                pointer-events: none;
            }
            .content {
                position: relative;
                z-index: 1;
            }
            h1 { text-align: center; }
            h2 { margin-top: 40px; color: #444; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
            th { background-color:rgba(243, 243, 243, 0.68); }
            a { color: #0077cc; text-decoration: none; }
        </style>
    </head>
    <body>
        <img src="https://res.cloudinary.com/ddm2qblsr/image/upload/v1744511093/full-removebg-preview_evknaa.png" class="watermark" />
        <div class="content">
            <h1>Material Order for ${contact.name}</h1>

            <h2>Contact Details</h2>
            <table>
                <tr><th>Name</th><td>${contact.name}</td></tr>
                <tr><th>Email</th><td>${contact.email}</td></tr>
                <tr><th>Phone</th><td>${contact.phone}</td></tr>
                <tr><th>Address</th><td>${contact.address}</td></tr>
            </table>

            ${materials
            .filter(material => material.brandDetails.length > 0)
            .map(material => `
                    <h2>${material.name}</h2>
                    <table>
                        <tr>
                            <th>Brand</th>
                            <th>Quantity</th>
                            <th>Need Price</th>
                        </tr>
                        ${material.brandDetails.map(detail => `
                            <tr>
                                <td>${detail.brand}</td>
                                <td>
                                    ${material.inputType === 'file'
                    ? `<a href="${detail.quantity}" target="_blank">${detail.quantity}</a>`
                    : detail.quantity}
                                </td>
                                <td>${detail.needPrice === true || detail.needPrice === 'true' ? 'Yes' : 'No'}</td>
                            </tr>
                        `).join('')}
                    </table>
                `).join('')}
        </div>
    </body>
</html>
`;


    let pdfBuffer;
    try {
        const file = { content: htmlContent };
        pdfBuffer = await pdf.generatePdf(file, {
            format: 'A4',
            timeout: 60000
        });
        console.log('✅ PDF generated successfully.');
    } catch (err) {
        console.error('❌ Error generating PDF:', err);
        return res.status(500).json({ error: 'PDF generation failed', details: err.toString() });
    }

    const adminMailContent = getCompiledTemplate('constrution-request.html', { username: "Admin" });
    const userMailContent = getCompiledTemplate('constrution-request.html', { username: contact.name });

    try {
        await sendEmail({
            to: ['karnamshyam9009@gmail.com'],
            subject: `New Material Order from ${contact.name}`,
            html: adminMailContent,
            attachments: [{
                filename: fileName,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }]
        });

        // await sendEmail({
        //     to: contact.email,
        //     subject: `Your material order has been submitted - ${contact.name}`,
        //     html: userMailContent,
        //     attachments: [{
        //         filename: fileName,
        //         content: pdfBuffer,
        //         contentType: 'application/pdf'
        //     }]
        // });

        console.log('📧 Emails sent successfully.');
        res.status(200).json({ message: 'Material order submitted and emails sent!' });

    } catch (error) {
        console.error('❌ Email sending failed:', error);
        res.status(500).json({ error: 'Email sending failed', reason: error.toString() });
    }
});

app.post("/submit-architecture-design", async (req, res) => {
    const { contactDetails, mainData } = req.body;

    if (!contactDetails || !mainData || !Array.isArray(mainData)) {
        return res.status(400).json({ error: 'Contact details and mainData are required.' });
    }

    const timestamp = Date.now();
    const safeName = contactDetails.name.replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
    const fileName = `${safeName}_architecture_design_${timestamp}.pdf`;

    const htmlContent = `
    <html>
        <head>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 40px;
                    position: relative;
                }
                .watermark {
                    position: fixed;
                    top: 35%;
                    left: 50%;
                    transform: translate(-50%, -50%) rotate(-30deg);
                    opacity: 0.2;
                    width: 70%;
                    z-index: 0;
                    pointer-events: none;
                }
                .content {
                    position: relative;
                    z-index: 1;
                }
                h1 { text-align: center; }
                h2 { margin-top: 40px; color: #444; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                th { background-color: rgba(243, 243, 243, 0.68); }
            </style>
        </head>
        <body>
            <img src="https://res.cloudinary.com/ddm2qblsr/image/upload/v1744511093/full-removebg-preview_evknaa.png" class="watermark" />
            <div class="content">
                <h1>Architecture Design Request - ${contactDetails.name}</h1>

                <h2>Contact Details</h2>
                <table>
                    <tr><th>Name</th><td>${contactDetails.name}</td></tr>
                    <tr><th>Email</th><td>${contactDetails.email}</td></tr>
                    <tr><th>Phone</th><td>${contactDetails.phone}</td></tr>
                    <tr><th>Address</th><td>${contactDetails.address}</td></tr>
                </table>

                <h2>Requested Services</h2>
                <table>
                    <tr>
                        <th>Service Name</th>
                        <th>Description</th>
                        <th>Included</th>
                    </tr>
                    ${mainData.map(item => `
                        <tr>
                            <td>${item.name}</td>
                            <td>${item.description || '-'}</td>
                            <td>${item.option === 'Yes' ? '✅ Yes' : '❌ No'}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        </body>
    </html>
    `;

    let pdfBuffer;
    try {
        const file = { content: htmlContent };
        pdfBuffer = await pdf.generatePdf(file, {
            format: 'A4',
            timeout: 60000
        });
        console.log('✅ Architecture PDF generated successfully.');
    } catch (err) {
        console.error('❌ Error generating architecture PDF:', err);
        return res.status(500).json({ error: 'PDF generation failed', details: err.toString() });
    }

    const adminMailContent = getCompiledTemplate('constrution-request.html', { username: "Admin" });
    const userMailContent = getCompiledTemplate('constrution-request.html', { username: contactDetails.name });

    try {
        await sendEmail({
            to: ['karnamshyam9009@gmail.com'],
            subject: `New Architecture Design Request - ${contactDetails.name}`,
            html: adminMailContent,
            attachments: [{
                filename: fileName,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }]
        });

        // await sendEmail({
        //     to: contactDetails.email,
        //     subject: `Your architecture design request has been received - ${contactDetails.name}`,
        //     html: userMailContent,
        //     attachments: [{
        //         filename: fileName,
        //         content: pdfBuffer,
        //         contentType: 'application/pdf'
        //     }]
        // });

        console.log('📧 Architecture request emails sent successfully.');
        res.status(200).json({ message: 'Architecture request submitted and emails sent!' });

    } catch (error) {
        console.error('❌ Email sending failed:', error);
        res.status(500).json({ error: 'Email sending failed', reason: error.toString() });
    }
});

app.post("/submit-interior-design", async (req, res) => {
    const { contactDetails, designDetails } = req.body;

    if (!contactDetails || !designDetails) {
        return res.status(400).json({ error: 'Contact details and designDetails are required.' });
    }

    const timestamp = Date.now();
    const safeName = contactDetails.name.replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
    const fileName = `${safeName}_interior_design_${timestamp}.pdf`;

    const htmlContent = `
    <html>
        <head>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 40px;
                    position: relative;
                }
                .watermark {
                    position: fixed;
                    top: 35%;
                    left: 50%;
                    transform: translate(-50%, -50%) rotate(-30deg);
                    opacity: 0.2;
                    width: 70%;
                    z-index: 0;
                    pointer-events: none;
                }
                .content {
                    position: relative;
                    z-index: 1;
                }
                h1 { text-align: center; }
                h2 { margin-top: 40px; color: #444; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                th { background-color: rgba(243, 243, 243, 0.68); }
            </style>
        </head>
        <body>
            <img src="https://res.cloudinary.com/ddm2qblsr/image/upload/v1744511093/full-removebg-preview_evknaa.png" class="watermark" />
            <div class="content">
                <h1>Interior Design Request - ${contactDetails.name}</h1>

                <h2>Contact Details</h2>
                <table>
                    <tr><th>Name</th><td>${contactDetails.name}</td></tr>
                    <tr><th>Email</th><td>${contactDetails.email}</td></tr>
                    <tr><th>Phone</th><td>${contactDetails.phone}</td></tr>
                    <tr><th>Address</th><td>${contactDetails.address}</td></tr>
                </table>

                <h2>Interior Design Specifications</h2>
                <table>
                    <tr><th>Feature</th><th>Value</th></tr>
                    ${Object.entries(designDetails).map(([key, value]) => `
                        <tr>
                            <td>${key.charAt(0).toUpperCase() + key.slice(1)}</td>
                            <td>${typeof value === 'boolean' ? (value ? '✅ Yes' : '❌ No') : value}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        </body>
    </html>
    `;

    let pdfBuffer;
    try {
        const file = { content: htmlContent };
        pdfBuffer = await pdf.generatePdf(file, {
            format: 'A4',
            timeout: 60000
        });
        console.log('✅ Interior Design PDF generated successfully.');
    } catch (err) {
        console.error('❌ Error generating PDF:', err);
        return res.status(500).json({ error: 'PDF generation failed', details: err.toString() });
    }

    const adminMailContent = getCompiledTemplate('interior-request.html', { username: "Admin" });
    const userMailContent = getCompiledTemplate('interior-request.html', { username: contactDetails.name });

    try {
        await sendEmail({
            to: ['karnamshyam9009@gmail.com'],
            subject: `New Interior Design Request - ${contactDetails.name}`,
            html: adminMailContent,
            attachments: [{
                filename: fileName,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }]
        });

        // Optional: Send to user
        // await sendEmail({
        //     to: contactDetails.email,
        //     subject: `Your interior design request has been received - ${contactDetails.name}`,
        //     html: userMailContent,
        //     attachments: [{
        //         filename: fileName,
        //         content: pdfBuffer,
        //         contentType: 'application/pdf'
        //     }]
        // });

        console.log('📧 Interior request emails sent successfully.');
        res.status(200).json({ message: 'Interior design request submitted and emails sent!' });

    } catch (error) {
        console.error('❌ Email sending failed:', error);
        res.status(500).json({ error: 'Email sending failed', reason: error.toString() });
    }
});


app.get("/", (req, res) => {
    return res.status(200).json({ "status": "UP" })
})

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/upload", uploadRouter);
app.use("/api/v1/builders", builderRouter);
app.use("/api/v1/properties", propertyRouter);

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ Connected to MongoDB');

    initializeDefaultAdmin();

    app.listen(PORT, () => {
        console.log(`🚀 Server started on http://localhost:${PORT}`);
    });

}).catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
});

