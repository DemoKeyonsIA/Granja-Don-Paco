const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/import \{ \$\{p1\}, Sparkles \} from "lucide-react";/, "import { Activity, Bot, ChevronRight, DollarSign, LayoutDashboard, LogOut, PackageOpen, Plus, Send, Settings, User as UserIcon, X, Loader2, Info, Navigation, Truck, RefreshCcw, Sparkles } from 'lucide-react';");

fs.writeFileSync('src/App.tsx', code);
