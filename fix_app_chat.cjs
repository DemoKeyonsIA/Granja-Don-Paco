const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const oldState = `  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedData | null>(null);
  const [error, setError] = useState<string | null>(null);`;

const newState = `  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const [error, setError] = useState<string | null>(null);`;

code = code.replace(oldState, newState);

const oldSubmit = `  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar el mensaje');
      }

      setResult(data);
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };`;

const newSubmit = `  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || loading) return;

    const userMessage = message.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setMessage('');
    
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat/estela', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar el mensaje');
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
      
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };`;

code = code.replace(oldSubmit, newSubmit);

fs.writeFileSync('src/App.tsx', code);
