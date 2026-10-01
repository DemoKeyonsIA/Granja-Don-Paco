import React from 'react';
import { Calendar, Clock, CheckCircle, AlertCircle, Users, Activity } from 'lucide-react';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Dashboard() {
  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in pb-20">
      <div>
        <h2 className="text-2xl font-bold text-neutral-800 tracking-tight">Dashboard ILCASU®</h2>
        <p className="text-neutral-500 text-sm">Resumen Operativo de la Clínica</p>
      </div>

      {/* Semáforo Operativo */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
        <div className="flex items-center space-x-2 mb-6">
          <Activity className="w-6 h-6 text-blue-600" />
          <h3 className="text-lg font-bold text-neutral-800">Semáforo Operativo (Hoy)</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-amber-50 p-6 rounded-xl border border-amber-200 flex flex-col items-center text-center">
            <Clock className="w-8 h-8 text-amber-600 mb-3" />
            <p className="text-4xl font-black text-amber-900 mb-1">12</p>
            <p className="text-sm font-bold text-amber-700 uppercase tracking-wider">Citas Pendientes</p>
          </div>
          
          <div className="bg-red-50 p-6 rounded-xl border border-red-200 flex flex-col items-center text-center shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-red-500"></div>
            <AlertCircle className="w-8 h-8 text-red-600 mb-3" />
            <p className="text-4xl font-black text-red-900 mb-1">3</p>
            <p className="text-sm font-bold text-red-700 uppercase tracking-wider">Citas Retrasadas</p>
          </div>

          <div className="bg-emerald-50 p-6 rounded-xl border border-emerald-200 flex flex-col items-center text-center">
            <CheckCircle className="w-8 h-8 text-emerald-600 mb-3" />
            <p className="text-4xl font-black text-emerald-900 mb-1">8</p>
            <p className="text-sm font-bold text-emerald-700 uppercase tracking-wider">Citas Concluidas</p>
          </div>
        </div>
      </div>

      {/* Próximos Pacientes */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
        <h3 className="font-bold text-neutral-800 mb-4 border-b pb-2">Pacientes en Sala de Espera</h3>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex justify-between items-center p-4 bg-neutral-50 rounded-xl border border-neutral-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                  P{i}
                </div>
                <div>
                  <p className="font-bold text-neutral-800">Paciente #{i}</p>
                  <p className="text-xs text-neutral-500">Motivo: Evaluación general</p>
                </div>
              </div>
              <button className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm">Iniciar Consulta (RIC)</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
