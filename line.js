// ไฟล์: api/line.js
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { to, messages } = req.body;
    const LINE_TOKEN = "r6i+nxj/EOmeX45xvmIVgR3VxbJgMN8JDP+OtfBkaLEJQqgFTahqmiTatWrZyjt6FpUtVsQuI7EzT1YoNct03jVrpazdcYalcwow2bGD2NKRGGk8lySTSmyLfrz/WYv4D+o6hZj8beldu+KIw83JpAdB04t89/1O/w1cDnyilFU=";

    try {
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_TOKEN}`
            },
            body: JSON.stringify({
                to: to,
                messages: messages
            })
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(500).json({ error });
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}