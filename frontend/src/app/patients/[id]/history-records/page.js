'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { 
  Activity, ArrowLeft, Calendar, FileText, Heart, Shield, 
  User, Award, Phone, Mail, Clock, CheckCircle2 
} from 'lucide-react';

export default function PatientHistoryRecords() {
  const params = useParams();
  const router = useRouter();
  const { id } = params;
  const { token, API_BASE_URL, user } = useAuth();

  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Redirect if not logged in
    if (!token) {
      router.push('/login');
      return;
    }

    const fetchPatientData = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/patients/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('Patient record not found.');
          }
          throw new Error('Failed to retrieve patient clinical record.');
        }

        const data = await res.json();
        setPatient(data);
      } catch (err) {
        console.error('Fetch patient clinical history error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchPatientData();
  }, [id, token, API_BASE_URL, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gradient-bg p-6">
        <div className="pulse-loader">
          <div></div>
          <div></div>
        </div>
        <p className="mt-4 text-sm font-semibold text-slate-400 dark:text-slate-400">
          Retrieving Clinical Records...
        </p>
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gradient-bg p-6">
        <div className="glass p-8 max-w-md w-full rounded-2xl border border-rose-500/20 shadow-xl text-center">
          <div className="p-4 bg-rose-500/10 text-rose-500 rounded-full w-fit mx-auto mb-4">
            <Shield className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            Error Accessing Record
          </h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400 text-sm">
            {error || 'Patient clinical history record could not be loaded.'}
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="glow-btn mt-6 px-6 py-2.5 bg-slate-900 text-white dark:bg-teal-500 dark:text-slate-950 font-bold text-sm rounded-xl hover:bg-slate-800 dark:hover:bg-teal-400 transition-colors inline-flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col gradient-bg py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 font-bold text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          
          <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-bold uppercase tracking-wider border border-rose-500/20 shadow-sm">
            <Heart className="h-3.5 w-3.5 fill-current animate-pulse" />
            Official Clinical Dossier
          </div>
        </div>

        {/* Clinical Dossier Main Card */}
        <div className="glass rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex-1 flex flex-col">
          {/* Hospital Header Banner */}
          <div className="bg-slate-900 text-white p-6 sm:p-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 relative overflow-hidden">
            <div className="absolute inset-0 bg-radial-gradient(circle, rgba(20,184,166,0.1) 0%, transparent 80%) opacity-50"></div>
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-teal-400 font-extrabold text-xs tracking-widest uppercase mb-1">
                <Activity className="h-4 w-4" />
                HAQMS Clinical Systems
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
                DIAGNOSTIC REPORT DETAILS
              </h1>
              <p className="text-slate-400 text-xs mt-1 font-mono">
                RECORD ID: {patient.id.toUpperCase()}
              </p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-right relative z-10">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Status
              </span>
              <span className="text-teal-400 text-sm font-black uppercase tracking-wider flex items-center gap-1.5 justify-end">
                <CheckCircle2 className="h-3.5 w-3.5" />
                VERIFIED
              </span>
            </div>
          </div>

          {/* Patient Details Sub-grid */}
          <div className="p-6 sm:p-8 border-b border-slate-200 dark:border-slate-800 bg-slate-500/5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
              Patient Demographic Metadata
            </h3>
            <div className="grid gap-6 grid-cols-2 md:grid-cols-4">
              <div className="space-y-1">
                <span className="text-xs text-slate-400 dark:text-slate-400 font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-teal-500" />
                  Full Name
                </span>
                <span className="block text-sm font-extrabold text-slate-800 dark:text-slate-100">
                  {patient.name}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-400 dark:text-slate-400 font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-teal-500" />
                  Age &amp; Gender
                </span>
                <span className="block text-sm font-extrabold text-slate-800 dark:text-slate-100">
                  {patient.age} yrs / {patient.gender}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-400 dark:text-slate-400 font-semibold flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-teal-500" />
                  Phone Number
                </span>
                <span className="block text-sm font-extrabold text-slate-800 dark:text-slate-100 font-mono">
                  {patient.phoneNumber}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-400 dark:text-slate-400 font-semibold flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-teal-500" />
                  Email Address
                </span>
                <span className="block text-sm font-extrabold text-slate-800 dark:text-slate-100 font-mono truncate">
                  {patient.email || 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Clinical Narrative Content */}
          <div className="p-6 sm:p-8 flex-1 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                Clinical Narrative &amp; Background
              </h2>
            </div>
            
            <div className="flex-1 bg-slate-500/5 rounded-2xl p-6 border border-slate-200 dark:border-slate-800/80 shadow-inner relative">
              <p className="text-slate-700 dark:text-slate-200 leading-7 text-sm font-medium whitespace-pre-wrap">
                {patient.medicalHistory || 'No historical clinical diagnostic record has been registered for this patient.'}
              </p>
            </div>
          </div>

          {/* Verification & Footer */}
          <div className="p-6 sm:p-8 border-t border-slate-200 dark:border-slate-800 bg-slate-500/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-teal-500/10 text-teal-600 dark:text-teal-400 rounded-xl">
                <Award className="h-6 w-6" />
              </div>
              <div>
                <span className="block text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                  Verified Electronic Record
                </span>
                <span className="block text-[11px] text-slate-400 font-semibold mt-0.5">
                  Signed by: Chief Clinical Informatics Director
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs font-mono">
              <Clock className="h-4 w-4" />
              Retrieved: {new Date().toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
