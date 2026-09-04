'use client'

import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ArrowLeft, Upload, Plus, Trash2 } from 'lucide-react'

interface ScreeningDate {
  screening_date: string
  screening_time: string
  venue: string
  location_city: string
  address: string
  closed_captioned: boolean
}

export default function FilmScreeningsAdmin() {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    about_film: '',
    rating: '',
    running_time: '',
    trailer_url: ''
  })

  const [posterFile, setPosterFile] = useState<File | null>(null)
  const [posterPreview, setPosterPreview] = useState<string>('')
  const [screeningDates, setScreeningDates] = useState<ScreeningDate[]>([
    { screening_date: '', screening_time: '', venue: '', location_city: '', address: '', closed_captioned: false }
  ])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  const handlePosterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPosterFile(file)
      const reader = new FileReader()
      reader.onload = (e) => setPosterPreview(e.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleUploadAreaClick = () => {
    fileInputRef.current?.click()
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      setPosterFile(file)
      const reader = new FileReader()
      reader.onload = (event) => setPosterPreview(event.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleDateChange = (index: number, field: string, value: string | boolean) => {
    const newDates = [...screeningDates]
    newDates[index] = { ...newDates[index], [field]: value }
    setScreeningDates(newDates)
  }

  const addScreeningDate = () => {
    setScreeningDates([
      ...screeningDates,
      { screening_date: '', screening_time: '', venue: '', location_city: '', address: '', closed_captioned: false }
    ])
  }

  const removeScreeningDate = (index: number) => {
    setScreeningDates(screeningDates.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      // Validate at least one screening date is filled
      const validDates = screeningDates.filter(d => d.screening_date && d.screening_time && d.venue && d.location_city)
      if (validDates.length === 0) {
        throw new Error('Please add at least one complete screening date with date, time, venue, and city')
      }

      let posterUrl = ''

      // Upload poster if provided
      if (posterFile) {
        const fileName = `${Date.now()}-${posterFile.name}`
        const { data, error: uploadError } = await supabase.storage
          .from('film-posters')
          .upload(fileName, posterFile)

        if (uploadError) throw new Error(`Poster upload failed: ${uploadError.message}`)

        const { data: { publicUrl } } = supabase.storage
          .from('film-posters')
          .getPublicUrl(fileName)

        posterUrl = publicUrl
      }

      // Create film screening
      const { data: filmData, error: filmError } = await supabase
        .from('film_screenings')
        .insert({
          title: formData.title,
          description: formData.description,
          about_film: formData.about_film,
          rating: formData.rating,
          running_time: formData.running_time,
          trailer_url: formData.trailer_url,
          poster_url: posterUrl,
          published: true,
          published_at: new Date().toISOString()
        })
        .select()

      if (filmError) throw new Error(`Failed to create film screening: ${filmError.message}`)
      if (!filmData || filmData.length === 0) throw new Error('No film data returned from database')

      // Add screening dates (only valid ones)
      const filmId = filmData[0].id
      const dateRecords = validDates.map(d => ({
        film_screening_id: filmId,
        screening_date: d.screening_date,
        screening_time: d.screening_time,
        venue: d.venue,
        location_city: d.location_city,
        address: d.address || null,
        closed_captioned: d.closed_captioned
      }))

      const { error: datesError } = await supabase
        .from('screening_dates')
        .insert(dateRecords)

      if (datesError) throw new Error(`Failed to add screening dates: ${datesError.message}`)

      setMessage('✓ Film screening created successfully!')
      setFormData({
        title: '',
        description: '',
        about_film: '',
        rating: '',
        running_time: '',
        trailer_url: ''
      })
      setPosterFile(null)
      setPosterPreview('')
      setScreeningDates([{ screening_date: '', screening_time: '', venue: '', location_city: '', address: '', closed_captioned: false }])
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      setMessage(`❌ Error: ${errorMsg}`)
      console.error('Film screening error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <Link href="/admin" style={styles.backLink}>
          <ArrowLeft size={20} />
          Back to Admin
        </Link>
        <h1>Create Film Screening</h1>
        <div style={{ width: '120px' }} />
      </header>

      <main style={styles.main}>
        <div style={styles.card}>
          <form onSubmit={handleSubmit}>
            {/* Film Title */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Film Title *</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                placeholder="e.g., I SWEAR"
                required
                style={styles.input}
              />
            </div>

            {/* Short Description */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Short Description *</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Brief description for the announcement..."
                rows={3}
                required
                style={styles.textarea}
              />
            </div>

            {/* Poster Upload */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Movie Poster</label>
              <div
                style={styles.uploadArea}
                onClick={handleUploadAreaClick}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePosterChange}
                  style={styles.fileInput}
                />
                <Upload size={24} />
                <p>Click to upload or drag and drop</p>
                {posterFile && <p style={{ fontSize: '12px', color: '#666' }}>✓ {posterFile.name}</p>}
              </div>
              {posterPreview && (
                <img
                  src={posterPreview}
                  alt="Poster preview"
                  style={styles.posterPreview}
                />
              )}
            </div>

            {/* About Film */}
            <div style={styles.formGroup}>
              <label style={styles.label}>About the Film *</label>
              <textarea
                name="about_film"
                value={formData.about_film}
                onChange={handleInputChange}
                placeholder="Detailed description, cast, director info..."
                rows={5}
                required
                style={styles.textarea}
              />
            </div>

            {/* Rating */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Rating & Content Warnings</label>
              <input
                type="text"
                name="rating"
                value={formData.rating}
                onChange={handleInputChange}
                placeholder="e.g., Rated R for language and violence"
                style={styles.input}
              />
            </div>

            {/* Running Time */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Running Time</label>
              <input
                type="text"
                name="running_time"
                value={formData.running_time}
                onChange={handleInputChange}
                placeholder="e.g., 2 hours 15 minutes"
                style={styles.input}
              />
            </div>

            {/* Trailer URL */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Trailer URL</label>
              <input
                type="url"
                name="trailer_url"
                value={formData.trailer_url}
                onChange={handleInputChange}
                placeholder="YouTube or other trailer link"
                style={styles.input}
              />
            </div>

            {/* Screening Dates */}
            <div style={styles.datesSection}>
              <h3>Screening Dates & Locations</h3>
              {screeningDates.map((date, index) => (
                <div key={index} style={styles.dateCard}>
                  <div style={styles.dateGrid}>
                    <div>
                      <label style={styles.label}>Date *</label>
                      <input
                        type="date"
                        value={date.screening_date}
                        onChange={(e) => handleDateChange(index, 'screening_date', e.target.value)}
                        required
                        style={styles.input}
                      />
                    </div>
                    <div>
                      <label style={styles.label}>Time *</label>
                      <input
                        type="time"
                        value={date.screening_time}
                        onChange={(e) => handleDateChange(index, 'screening_time', e.target.value)}
                        required
                        style={styles.input}
                      />
                    </div>
                  </div>

                  <div style={styles.dateGrid}>
                    <div>
                      <label style={styles.label}>Venue *</label>
                      <input
                        type="text"
                        value={date.venue}
                        onChange={(e) => handleDateChange(index, 'venue', e.target.value)}
                        placeholder="Theater name"
                        required
                        style={styles.input}
                      />
                    </div>
                    <div>
                      <label style={styles.label}>City *</label>
                      <input
                        type="text"
                        value={date.location_city}
                        onChange={(e) => handleDateChange(index, 'location_city', e.target.value)}
                        placeholder="e.g., Newton, NC"
                        required
                        style={styles.input}
                      />
                    </div>
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Address</label>
                    <input
                      type="text"
                      value={date.address}
                      onChange={(e) => handleDateChange(index, 'address', e.target.value)}
                      placeholder="Street address"
                      style={styles.input}
                    />
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer', margin: '4px 0 6px' }}>
                    <input
                      type="checkbox"
                      checked={date.closed_captioned}
                      onChange={(e) => handleDateChange(index, 'closed_captioned', e.target.checked)}
                    />
                    Closed Captioned (all dialogue shown on screen)
                  </label>

                  {screeningDates.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeScreeningDate(index)}
                      style={styles.deleteBtn}
                    >
                      <Trash2 size={16} />
                      Remove Date
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={addScreeningDate}
                style={styles.addDateBtn}
              >
                <Plus size={16} />
                Add Another Date
              </button>
            </div>

            {message && (
              <div style={{
                ...styles.message,
                background: message.includes('Error') ? '#fee2e2' : '#d1fae5',
                color: message.includes('Error') ? '#7f1d1d' : '#065f46'
              }}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.submitBtn,
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? 'Creating...' : 'Create Film Screening'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f9fafb'
  },
  header: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  backLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'white',
    textDecoration: 'none',
    cursor: 'pointer'
  },
  main: {
    maxWidth: '900px',
    margin: '40px auto',
    padding: '0 20px'
  },
  card: {
    background: 'white',
    borderRadius: '12px',
    padding: '30px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  formGroup: {
    marginBottom: '24px'
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    marginBottom: '8px',
    color: '#1f2937'
  },
  input: {
    width: '100%',
    padding: '10px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'inherit'
  },
  textarea: {
    width: '100%',
    padding: '10px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'inherit',
    fontResize: 'vertical' as const
  },
  uploadArea: {
    border: '2px dashed #d1d5db',
    borderRadius: '6px',
    padding: '40px',
    textAlign: 'center' as const,
    cursor: 'pointer'
  },
  fileInput: {
    display: 'none'
  },
  posterPreview: {
    marginTop: '16px',
    maxWidth: '200px',
    borderRadius: '6px'
  },
  datesSection: {
    marginTop: '40px',
    paddingTop: '40px',
    borderTop: '1px solid #e5e7eb'
  },
  dateCard: {
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '16px'
  },
  dateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
    marginBottom: '12px'
  },
  deleteBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: '#fee2e2',
    color: '#7f1d1d',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  addDateBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    background: '#dbeafe',
    color: '#1e40af',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600' as const
  },
  submitBtn: {
    width: '100%',
    padding: '12px',
    background: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600' as const,
    cursor: 'pointer',
    marginTop: '24px'
  },
  message: {
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '16px'
  }
}
